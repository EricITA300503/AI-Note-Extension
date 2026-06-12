import os
import json
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

app = FastAPI(title="Local Vault Bridge")

# CRITICAL: Allow CORS so the Chrome Extension can communicate with localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For production, lock this down to "chrome-extension://<your-extension-id>"
    allow_methods=["POST"],
    allow_headers=["*"],
)

# Payload schema matching the extension's JSON
class CapturePayload(BaseModel):
    chat_text: str
    selected_system_prompt: str

# Config
VAULT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "Vault"))
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3" # Ensure you have this model pulled via `ollama run llama3`

@app.post("/capture")
async def process_capture(payload: CapturePayload):
    # Ensure Vault directory exists
    os.makedirs(VAULT_DIR, exist_ok=True)

    # Combine system prompt with the captured text
    full_prompt = f"{payload.selected_system_prompt}\n\nText to process:\n{payload.chat_text}"

    # Call local Ollama API
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            response = await client.post(OLLAMA_URL, json={
                "model": OLLAMA_MODEL,
                "prompt": full_prompt,
                "stream": False
            })
            response.raise_for_status()
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Ollama connection error: {e}")

    # Extract LLM response
    result_data = response.json()
    llm_output = result_data.get("response", "Error: No response from model.")

    # Generate Markdown File
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = os.path.join(VAULT_DIR, f"Note_{timestamp}.md")

    markdown_content = (
        f"# Captured Note - {timestamp}\n\n"
        f"**Prompt Used:** {payload.selected_system_prompt}\n\n"
        f"## AI Summary\n\n"
        f"{llm_output}\n\n"
        f"---\n"
        f"## Original Source Text\n\n"
        f"{payload.chat_text}\n"
    )

    with open(filename, "w", encoding="utf-8") as f:
        f.write(markdown_content)

    # ADD 'markdown_content' to the return dictionary
    return {
        "status": "success", 
        "file_saved": filename, 
        "markdown": markdown_content
    }

if __name__ == "__main__":
    import uvicorn
    import multiprocessing

    multiprocessing.freeze_support()
    # Run the server on port 8000
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)