import os
import pandas as pd
import json
from google import genai
from google.genai import types

# 1. Initialize the Gemini Client
# Replace with your key from Google AI Studio (starts with AIzaSy)
GEMINI_API_KEY = "AIzaSyAcz580c7N92thrI1qw9FXzVBGkI8et9Ss" 
client = genai.Client(api_key=GEMINI_API_KEY)

print("🚀 Launching Gemini AI Agent to scour the web for Deep Tech & Materials VCs...")

# 2. Instruct the AI Agent with system boundaries
# 2. Instruct the AI Agent with your exact database schema
system_instruction = (
    "You are an expert venture capital sourcing agent. Your task is to reverse-engineer investor leads "
    "using a Crunchbase dataset with the following schema:\n"
    "['permalink', 'name', 'homepage_url', 'category_list', 'market', 'funding_total_usd', 'status', "
    "'country_code', 'state_code', 'region', 'city', 'funding_rounds', 'founded_at', 'seed', 'venture', "
    "'grant', 'round_A', 'round_B']\n\n"
    
    "Instructions:\n"
    "1. Identify early-stage startups from this schema that operate in Advanced Materials, Computational Chemistry, "
    "or Catalytic Converters.\n"
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
    print(f"\n🔍 Running Search: {query}")
    try:
        # 3. Call the Gemini Model with strict JSON schema enforcement
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=query,
            config=types.GenerateContentConfig(
                tools=[{"google_search": {}}],  # Grants Gemini access to live Google Search!
                system_instruction=system_instruction,
            ),
        )
        
        # 4. Parse the JSON response
        raw_text = response.text.strip()
        if raw_text.startswith("```json"):
            raw_text = raw_text[7:]
        elif raw_text.startswith("```"):
            raw_text = raw_text[3:]
        if raw_text.endswith("```"):
            raw_text = raw_text[:-3]
            
        vc_list = json.loads(raw_text.strip())
        all_vcs.extend(vc_list)
        print(f"✅ Found {len(vc_list)} VCs from this region.")
        
        # Smartly extract only the JSON array, ignoring any conversational text
        start_idx = raw_text.find('[')
        end_idx = raw_text.rfind(']')
        
        if start_idx != -1 and end_idx != -1:
            vc_list = json.loads(raw_text[start_idx:end_idx+1])
            all_vcs.extend(vc_list)
            print(f"✅ Found {len(vc_list)} VCs from this region.")
        else:
            print(f"❌ Failed to find a JSON array in the response. Raw output:\n{raw_text[:250]}...")
        
    except Exception as e:
        print(f"❌ Failed on this query: {e}")

# 5. Convert all accumulated results into Pandas DataFrame
if all_vcs:
    df = pd.DataFrame(all_vcs)
    
    # Inject pipeline tracking metadata columns
    df['Priority'] = 3
    df['Status'] = 'Researching'
    df['Amount Raise'] = ""
    df['Date'] = ""
    
    # Drop duplicates across regions just in case they overlap
    df.drop_duplicates(subset=["Firm Name"], inplace=True)
    
    # Force column reordering so they line up exactly with your Excel layout
    ordered_columns = [
        "Firm Name", "Target Partner", "Crunchbase", "Angel List", "Linkedin", 
        "Contact Information", "Amount Raise", "Date", "Sector Focus", 
        "Check Size", "Priority", "Status", "Comments"
    ]
    df = df.reindex(columns=ordered_columns)
    
    # 6. Export directly to your spreadsheet
    output_filename = "Gemini_Generated_DeepTech_Pipeline.xlsx"
    df.to_excel(output_filename, index=False)
    print(f"\n✨ Success! Saved {len(df)} highly targeted, deduplicated leads to '{output_filename}'.")
else:
    print("\n❌ No VCs were found across any searches.")