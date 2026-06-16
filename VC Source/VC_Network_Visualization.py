import streamlit as st
import pandas as pd
import json
import os
import tempfile
from google import genai
from google.genai import types
from pyvis.network import Network
import streamlit.components.v1 as components

# --- 1. Streamlit Page Configuration ---
st.set_page_config(layout="wide", page_title="VC Sourcing & Network Tool")
st.title("Interactive VC Sourcing Agent & Network Graph")

# --- 2. API Key Configuration (Secure) ---
if "GEMINI_API_KEY" in st.secrets:
    api_key = st.secrets["GEMINI_API_KEY"]
else:
    api_key = st.sidebar.text_input("Enter Gemini API Key", type="password", help="Get a key from Google AI Studio")

# Define file pathway safely
DATA_FILENAME = "Gemini_Generated_DeepTech_Pipeline.xlsx"

# --- 3. Sidebar: AI Sourcing Controls ---
st.sidebar.header("🤖 AI Sourcing Agent")
st.sidebar.markdown("Scour the live web using Gemini 2.5 Flash to build or refresh your lead pipeline.")

if st.sidebar.button("Run AI Sourcing Pipeline"):
    if not api_key:
        st.sidebar.error("Please provide a valid Gemini API Key to run the sourcing agent.")
    else:
        with st.spinner("🚀 Launching Gemini AI Agent to scour the web... This may take a moment."):
            try:
                client = genai.Client(api_key=api_key)
                
                system_instruction = (
                    "You are an expert venture capital sourcing agent. Your task is to reverse-engineer investor leads "
                    "using a Crunchbase dataset with the following schema:\n"
                    "['permalink', 'name', 'homepage_url', 'category_list', 'market', 'funding_total_usd', 'status', "
                    "'country_code', 'state_code', 'region', 'city', 'funding_rounds', 'founded_at', 'seed', 'venture', "
                    "'grant', 'round_A', 'round_B']\n\n"
                    "Instructions:\n"
                    "1. Identify early-stage startups from this schema that operate in Advanced Materials, Computational Chemistry, or Catalytic Converters.\n"
                    "2. Determine which Venture Capital firms funded these companies (looking at seed, venture, round_A, round_B).\n"
                    "3. Map these discovered VC firms directly into the requested JSON layout below.\n\n"
                    "You must return the data strictly as a JSON list of objects matching these exact keys:\n"
                    "['Firm Name', 'Target Partner', 'Crunchbase', 'Angel List', 'Linkedin', 'Contact Information', "
                    "'Sector Focus', 'Check Size', 'Priority', 'Status', 'Comments']\n\n"
                    "IMPORTANT: Return ONLY a valid JSON array. Do not include markdown formatting like ```json or any conversational text."
                )

                search_queries = [
                    "Search the live web for 200 highly accurate pre-seed/seed VCs that actively invest in Deep Tech or Advanced Materials in the USA.",
                    "Search the live web for 200 highly accurate pre-seed/seed VCs that actively invest in Deep Tech or Advanced Materials in Europe.",
                    "Search the live web for 200 highly accurate pre-seed/seed VCs that actively invest in Computational Chemistry or Catalytic Converters globally."
                ]

                all_vcs = []

                for query in search_queries:
                    response = client.models.generate_content(
                        model='gemini-2.5-flash',
                        contents=query,
                        config=types.GenerateContentConfig(
                            tools=[{"google_search": {}}],
                            system_instruction=system_instruction,
                        ),
                    )
                    
                    raw_text = response.text.strip()
                    
                    # Clean markdown code blocks safely
                    start_idx = raw_text.find('[')
                    end_idx = raw_text.rfind(']')
                    
                    if start_idx != -1 and end_idx != -1:
                        vc_list = json.loads(raw_text[start_idx:end_idx+1])
                        all_vcs.extend(vc_list)
                    else:
                        st.sidebar.warning(f"Could not parse perfect JSON array for query: {query[:30]}...")

                if all_vcs:
                    df_new = pd.DataFrame(all_vcs)
                    df_new['Priority'] = 3
                    df_new['Status'] = 'Researching'
                    df_new['Amount Raise'] = ""
                    df_new['Date'] = ""
                    
                    df_new.drop_duplicates(subset=["Firm Name"], inplace=True)
                    
                    ordered_columns = [
                        "Firm Name", "Target Partner", "Crunchbase", "Angel List", "Linkedin", 
                        "Contact Information", "Amount Raise", "Date", "Sector Focus", 
                        "Check Size", "Priority", "Status", "Comments"
                    ]
                    df_new = df_new.reindex(columns=ordered_columns)
                    df_new.to_excel(DATA_FILENAME, index=False)
                    st.sidebar.success(f"✨ Found and saved {len(df_new)} leads successfully!")
                    st.cache_data.clear() # Clear cache to force reloading new data
                else:
                    st.sidebar.error("No VCs were gathered across queries.")
            except Exception as e:
                st.sidebar.error(f"Sourcing Error: {e}")

# --- 4. Load Data Pipeline ---
@st.cache_data
def load_data():
    if os.path.exists(DATA_FILENAME):
        df = pd.read_excel(DATA_FILENAME)
        df.columns = df.columns.str.strip()
        df.dropna(axis=1, how='all', inplace=True)
        cols_to_remove = [col for col in df.columns if col.lower() == 'angel list']
        if cols_to_remove:
            df.drop(columns=cols_to_remove, inplace=True)
        return df
    return pd.DataFrame()

df = load_data()

if df.empty:
    st.info("👋 No lead pipeline database found yet. Run the **AI Sourcing Agent** in the sidebar to generate your initial VC list!")
    st.stop()

# --- 5. Network Controls (Sidebar Filters) ---
st.sidebar.markdown("---")
st.sidebar.header("Network Controls")
MY_COMPANY_NAME = st.sidebar.text_input("My Company Name", "Our Startup")

DEFAULT_KEYWORDS = ["advanced materials", "computational chemistry", "catalytic converters", "material science", "pre-seed", "seed"]
selected_keywords = st.sidebar.multiselect(
    "Company Character / Profile Keywords", 
    options=DEFAULT_KEYWORDS + ["biotechnology", "hardware", "software", "deep tech", "sustainability", "venture"],
    default=DEFAULT_KEYWORDS
)

min_suitability = st.sidebar.slider("Minimum Suitability Score", 0.0, 1.0, 0.1, 0.05)
max_nodes = st.sidebar.slider("Max VCs to Display", 10, 500, 75, 5)

# Identify dynamically mapped mapping keys
firm_col = 'Firm Name' if 'Firm Name' in df.columns else (df.columns[0] if len(df.columns) > 0 else 'name')
sector_col = 'Sector Focus' if 'Sector Focus' in df.columns else 'market'
funding_col = 'Amount Raise' if 'Amount Raise' in df.columns else 'funding_total_usd'

def calculate_suitability(vc_sector):
    if not isinstance(vc_sector, str):
        return 0.1 
    score = 0.1
    vc_sector_lower = vc_sector.lower()
    for keyword in selected_keywords:
        if keyword.lower() in vc_sector_lower:
            score += 0.4 
    return min(score, 1.0) 

# Numeric conversion safety
if funding_col in df.columns:
    df['Funding_Numeric'] = pd.to_numeric(df[funding_col].astype(str).str.replace(r'[^0-9.]', '', regex=True), errors='coerce').fillna(0)
else:
    df['Funding_Numeric'] = 0

df['Suitability'] = df[sector_col].apply(calculate_suitability)

# --- 6. Data Filtering & Sample Prep ---
df_filtered = df[df['Suitability'] >= min_suitability]
df_sample = df_filtered.sort_values(by='Suitability', ascending=False).head(max_nodes)

if df_sample.empty:
    st.warning("No VCs match the chosen filters. Try lowering the Minimum Suitability Score.")
    st.stop()

# --- 7. Build Graph Network (Using Temp Files for Deployment compatibility) ---
st.write(f"Displaying top **{len(df_sample)}** VCs matching selection criteria. Hover over nodes for deep analytics.")

net = Network(height='600px', width='100%', bgcolor='#222222', font_color='white')
net.force_atlas_2based()

# Target center startup node
net.add_node(MY_COMPANY_NAME, label=MY_COMPANY_NAME, title="Your Startup", color='#ff4b4b', size=50)

for index, row in df_sample.iterrows():
    vc_name = str(row[firm_col])
    suitability = row['Suitability']
    market = str(row[sector_col])
    funding = row['Funding_Numeric']
    partner = row.get('Target Partner', 'Unknown')
    
    title_html = f"<b>{vc_name}</b><br>Lead Partner: {partner}<br>Market Focus: {market}<br>Suitability: {suitability:.2f}"
    node_size = 10 + (suitability * 20)
    
    net.add_node(vc_name, label=vc_name, title=title_html, color='#4ba3ff', size=node_size)
    net.add_edge(MY_COMPANY_NAME, vc_name, value=suitability, title=f"Suitability: {suitability:.2f}")

# Save to a dynamically generated sandbox HTML location
with tempfile.NamedTemporaryFile(delete=False, suffix='.html', mode='w', encoding='utf-8') as tmp:
    net.save_graph(tmp.name)
    with open(tmp.name, 'r', encoding='utf-8') as f:
        html_string = f.read()

components.html(html_string, height=650)

# Optional Data Previewer Tab
with st.expander("📂 View Underlying Pipeline Data Matrix"):
    st.dataframe(df_sample[[firm_col, sector_col, 'Suitability', 'Target Partner', 'Contact Information']])