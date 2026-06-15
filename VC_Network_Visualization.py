import streamlit as st
import pandas as pd
from pyvis.network import Network
import streamlit.components.v1 as components
import os

# --- 1. Streamlit Page Configuration ---
st.set_page_config(layout="wide", page_title="VC Suitability Web")
st.title("Interactive VC Suitability Network")

# Based on your Gemini system prompt, these are your ideal keywords:
DEFAULT_KEYWORDS = [
    "advanced materials", "computational chemistry", 
    "catalytic converters", "material science", "pre-seed", "seed"
]

# --- 2. Interactive UI Controls (Sidebar) ---
st.sidebar.header("Network Controls")
MY_COMPANY_NAME = st.sidebar.text_input("My Company Name", "Our Startup")

selected_keywords = st.sidebar.multiselect(
    "Company Character / Profile Keywords", 
    options=DEFAULT_KEYWORDS + ["biotechnology", "hardware", "software", "deep tech", "sustainability", "venture"],
    default=DEFAULT_KEYWORDS
)

st.sidebar.markdown("### Filter Metrics")
min_suitability = st.sidebar.slider("Minimum Suitability Score", 0.0, 1.0, 0.1, 0.05)
max_nodes = st.sidebar.slider("Max VCs to Display", 10, 500, 75, 5)
min_funding = st.sidebar.number_input("Minimum Funding Total ($)", value=0)

st.sidebar.markdown("---")
st.sidebar.info("💡 **VC-VC Interconnections:** To add co-investment webs (VCs that invest together), you will need a Crunchbase or Pitchbook API key to fetch 'co-investors' dynamically. You would then add an edge between VC nodes here.")

INPUT_FILE = "/Users/wylie/Desktop/Gemini_Generated_DeepTech_Pipeline.xlsx"

# --- 3. Data Processing ---
@st.cache_data
def load_data():
    if os.path.exists(INPUT_FILE):
        df = pd.read_excel(INPUT_FILE)
        df.columns = df.columns.str.strip()
        df.dropna(axis=1, how='all', inplace=True)
        cols_to_remove = [col for col in df.columns if col.lower() == 'angel list']
        if cols_to_remove:
            df.drop(columns=cols_to_remove, inplace=True)
        return df
    return pd.DataFrame()

df = load_data()

if df.empty:
    st.warning(f"Could not load data from {INPUT_FILE}. Please check the path.")
    st.stop()

firm_col = 'name' if 'name' in df.columns else 'Firm Name'
sector_col = 'market' if 'market' in df.columns else 'Sector Focus'
funding_col = 'funding_total_usd' if 'funding_total_usd' in df.columns else 'Amount Raise'

def calculate_suitability(vc_sector):
    if not isinstance(vc_sector, str):
        return 0.1 
    score = 0.1
    vc_sector_lower = vc_sector.lower()
    for keyword in selected_keywords:
        if keyword.lower() in vc_sector_lower:
            score += 0.4 
    return min(score, 1.0) 

# Clean funding for numeric filtering
if funding_col in df.columns:
    df['Funding_Numeric'] = pd.to_numeric(df[funding_col].astype(str).str.replace(r'[^0-9.]', '', regex=True), errors='coerce').fillna(0)
else:
    df['Funding_Numeric'] = 0

df['Suitability'] = df[sector_col].apply(calculate_suitability)

# --- 4. Filtering ---
df_filtered = df[(df['Suitability'] >= min_suitability) & (df['Funding_Numeric'] >= min_funding)]
df_sample = df_filtered.sort_values(by='Suitability', ascending=False).head(max_nodes)

if df_sample.empty:
    st.warning("No VCs match the current filters.")
    st.stop()

# --- 5. Interactive Network Graph (PyVis) ---
st.write(f"Displaying top **{len(df_sample)}** VCs based on your criteria. Hover over nodes to see details!")

net = Network(height='600px', width='100%', bgcolor='#222222', font_color='white')
net.force_atlas_2based() # Physics engine for the web

# Add central company node
net.add_node(MY_COMPANY_NAME, label=MY_COMPANY_NAME, title="Your Startup", color='#ff4b4b', size=50)

for index, row in df_sample.iterrows():
    vc_name = str(row[firm_col])
    suitability = row['Suitability']
    market = str(row[sector_col])
    funding = row['Funding_Numeric']
    
    # HTML Tooltip that appears on hover
    title_html = f"<b>{vc_name}</b><br>Market: {market}<br>Funding: ${funding:,.0f}<br>Suitability: {suitability:.2f}"
    
    node_size = 10 + (suitability * 20)
    net.add_node(vc_name, label=vc_name, title=title_html, color='#4ba3ff', size=node_size)
    
    # Link VC to your company
    net.add_edge(MY_COMPANY_NAME, vc_name, value=suitability, title=f"Suitability: {suitability:.2f}")

# Generate and display in Streamlit
try:
    output_path = '/Users/wylie/Desktop/VC_Suitability_Network.html'
    net.save_graph(output_path)
    with open(output_path, 'r', encoding='utf-8') as HtmlFile:
        source_code = HtmlFile.read() 
    components.html(source_code, height=650)
    st.success(f"Interactive HTML web saved to: {output_path}")
except Exception as e:
    st.error(f"Error generating graph: {e}")