import os
import asyncio
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import re

task_queue = None
is_processing = False

class AppendTask(BaseModel):
    chat_id: str
    new_text: str
    system_prompt: str

async def llm_worker():
    global is_processing
    print("🤖 Background Worker started! Waiting for chat chunks...")
    while True:
        task = await task_queue.get()
        is_processing = True 
        try:
            print(f"📥 Received chunk for chat {task.chat_id}. Sending to Ollama...")
            await process_with_ollama(task)
            print(f"✅ Successfully wrote summary to Note_{task.chat_id}.md")
        except Exception as e:
            print(f"❌ Worker Error: {e}")
        finally:
            is_processing = False
            task_queue.task_done()

@asynccontextmanager
async def lifespan(app: FastAPI):
    global task_queue
    task_queue = asyncio.Queue()
    worker = asyncio.create_task(llm_worker())
    yield
    worker.cancel()

app = FastAPI(title="Local Vault Bridge", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VAULT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "Vault"))
OLLAMA_URL = "http://localhost:11434/api/generate"
HEAVY_OLLAMA_MODEL = "llama3"

class StartPayload(BaseModel):
    system_prompt: str

@app.post("/start")
async def start_recording(payload: StartPayload):
    os.makedirs(VAULT_DIR, exist_ok=True)
    chat_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = os.path.join(VAULT_DIR, f"Note_{chat_id}.md")

    initial_content = (
        f"# Procedural AI Chat Note - {chat_id}\n\n"
        f"**Prompt Used:** {payload.system_prompt}\n\n"
        f"## Rolling Summary\n\n"
        f"*Waiting for conversation to begin...*\n"
    )
    with open(filename, "w", encoding="utf-8") as f:
        f.write(initial_content)

    return {"status": "started", "chat_id": chat_id}

@app.post("/append")
async def append_recording(task: AppendTask):
    await task_queue.put(task)
    return {"status": "queued", "queue_size": task_queue.qsize()}

@app.get("/status")
async def get_status():
    return {
        "queue_size": task_queue.qsize() if task_queue else 0,
        "is_processing": is_processing
    }

@app.get("/download/{chat_id}")
async def download_recording(chat_id: str):
    filename = os.path.join(VAULT_DIR, f"Note_{chat_id}.md")
    if not os.path.exists(filename):
        raise HTTPException(status_code=404, detail="Note not found.")

    with open(filename, "r", encoding="utf-8") as f:
        content = f.read()

    # 🔥 FIX: No more aggressive regex parsing that risks data loss on Windows formatting.
    # Return the file data precisely as written by the background worker processes.
    print(f"📦 Delivering note file cleanly for Note_{chat_id}.md")
    return {"status": "success", "markdown": content, "filename": f"Note_{chat_id}.md"}

async def process_with_ollama(task: AppendTask):
    # This function now purely acts as a safe, instant file-appender.
    # No small AI models are used here, preventing data loss and regurgitation.
    filename = os.path.join(VAULT_DIR, f"Note_{task.chat_id}.md")
    if not os.path.exists(filename): 
        return

    with open(filename, "r", encoding="utf-8") as f:
        existing_content = f.read()

    if "*Waiting for conversation to begin...*" in existing_content:
        new_file_content = existing_content.replace("*Waiting for conversation to begin...*", task.new_text)
    else:
        new_file_content = existing_content + f"\n\n---\n\n{task.new_text}"

    with open(filename, "w", encoding="utf-8") as f:
        f.write(new_file_content)


@app.post("/synthesize/{chat_id}")
async def synthesize_note(chat_id: str):
    filename = os.path.join(VAULT_DIR, f"Note_{chat_id}.md")
    if not os.path.exists(filename):
        raise HTTPException(status_code=404, detail="Note not found.")

    with open(filename, "r", encoding="utf-8") as f:
        raw_content = f.read()

    if "*Waiting for conversation to begin...*" in raw_content:
        print("⚠️ No chat data recorded. Skipping heavy synthesis.")
        return {"status": "skipped", "reason": "No chat data found."}

    top_matter_match = re.search(r'(# Procedural AI Chat Note - .*?\n\n\*\*Prompt Used:\*\* .*?\n\n)', raw_content, re.DOTALL)
    top_matter = top_matter_match.group(1) if top_matter_match else f"# Procedural AI Chat Note - {chat_id}\n\n"

    instruction = (
        "You are an expert technical editor. Below is a raw, chronologically appended log of AI-extracted notes from a chat. "
        "Your task is to synthesize these fragmented pieces into ONE comprehensive, highly cohesive, and beautifully formatted Master Note.\n\n"
        "CRITICAL RULES:\n"
        "1. STRUCTURE: Create a clear hierarchy using Markdown (H3, H4, bullet points, bold text). Do not just list isolated points; group related concepts together logically.\n"
        "2. COHESION: Merge all duplicate information. Weave the insights together so it reads like a professional article or study guide.\n"
        "3. DETAILS & LINKS: Preserve every specific fact, number, tool, and book title. If links or creators are mentioned, format them clearly.\n"
        "4. REQUIRED HEADERS: You must use these exact four main headers to structure your document: ## 📌 Core Topics, ## 🧠 Key Insights & Details, ## 🛠️ Resources & Tools, ## 🚀 Action Items.\n\n"
        f"Raw Notes to Synthesize:\n{raw_content}"
    )

    async with httpx.AsyncClient(timeout=None) as client:
        try:
            response = await client.post(OLLAMA_URL, json={
                "model": HEAVY_OLLAMA_MODEL,
                "prompt": instruction,
                "stream": False
            })
            response.raise_for_status()
            final_summary = response.json().get("response", "").strip()

            if final_summary:
                final_content = f"{top_matter}{final_summary}"
                with open(filename, "w", encoding="utf-8") as f:
                    f.write(final_content)
                return {"status": "success"}
            else:
                print("⚠️ Heavy Synthesis returned an empty string.")
                return {"status": "failed", "reason": "Empty string from compiler"}
            
        except Exception as e:
            print(f"❌ Heavy Synthesis Failed: {e}")
            raise HTTPException(status_code=500, detail="Heavy Synthesis Failed")

if __name__ == "__main__":
    import uvicorn
    import multiprocessing
    multiprocessing.freeze_support()
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)