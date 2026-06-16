import os
import asyncio
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

task_queue = None
is_processing = False  # NEW: Tracks if Ollama is currently generating text

class AppendTask(BaseModel):
    chat_id: str
    new_text: str
    system_prompt: str

async def llm_worker():
    global is_processing
    print("🤖 Background Worker started! Waiting for chat chunks...")
    while True:
        task = await task_queue.get()
        is_processing = True  # Lock the status
        try:
            print(f"📥 Received chunk for chat {task.chat_id}. Sending to Ollama...")
            await process_with_ollama(task)
            print(f"✅ Successfully wrote summary to Note_{task.chat_id}.md")
        except Exception as e:
            print(f"❌ Worker Error: {e}")
        finally:
            is_processing = False  # Unlock the status
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
OLLAMA_MODEL = "qwen2.5:1.5b" 

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

# NEW: Status endpoint for the Chrome extension to poll
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
    return {"status": "success", "markdown": content, "filename": f"Note_{chat_id}.md"}

async def process_with_ollama(task: AppendTask):
    filename = os.path.join(VAULT_DIR, f"Note_{task.chat_id}.md")
    if not os.path.exists(filename): 
        print("⚠️ File not found, skipping...")
        return

    with open(filename, "r", encoding="utf-8") as f:
        existing_content = f.read()

    strict_rules = (
        "STRICT RULES:\n"
        "1. You are a passive note-taker and summarizer.\n"
        "2. DO NOT answer questions asked by the User or the AI.\n"
        "3. DO NOT invent, hallucinate, predict, or generate dialogue that is not explicitly provided.\n"
        "4. ONLY summarize the exact text provided below.\n\n"
    )

    if "*Waiting for conversation to begin...*" in existing_content:
        instruction = (
            f"{strict_rules}"
            f"Prompt: {task.system_prompt}\n\n"
            f"Summarize the following conversation:\n{task.new_text}"
        )
        replace_mode = True
    else:
        instruction = (
            f"{strict_rules}"
            f"Prompt: {task.system_prompt}\n\n"
            f"Here is the existing summary so far:\n{existing_content}\n\n"
            f"Here is the newest exchange:\n{task.new_text}\n\n"
            f"Update the summary to incorporate ONLY this new information. Output ONLY the updated Markdown summary."
        )
        replace_mode = False

    async with httpx.AsyncClient(timeout=None) as client:
        try:
            response = await client.post(OLLAMA_URL, json={
                "model": OLLAMA_MODEL,
                "prompt": instruction,
                "stream": False
            })
            response.raise_for_status()
            llm_output = response.json().get("response", "").strip()

            if llm_output:
                if replace_mode:
                    new_file_content = existing_content.replace("*Waiting for conversation to begin...*", llm_output)
                else:
                    header_idx = existing_content.find("## Rolling Summary\n\n")
                    if header_idx != -1:
                        new_file_content = existing_content[:header_idx + len("## Rolling Summary\n\n")] + llm_output
                    else:
                        new_file_content = existing_content + "\n\n" + llm_output

                with open(filename, "w", encoding="utf-8") as f:
                    f.write(new_file_content)
            else:
                print("⚠️ Ollama returned an empty string.")

        except Exception as e:
            print(f"❌ Ollama Request Failed: {e}")

if __name__ == "__main__":
    import uvicorn
    import multiprocessing
    multiprocessing.freeze_support()
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)