# main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from playwright.async_api import async_playwright
import traceback; traceback.print_exc()
from tagger import auto_tag

app = FastAPI()

class ScrapeRequest(BaseModel):
    url: str

@app.post('/register')
async def register_mcp_server(mcp_config: dict):
    print(f"Received MCP registration request: {mcp_config}")
    return {"status": "success", "message": "MCP registered successfully."}

@app.post('/scrape')
async def scrape(req: ScrapeRequest):
    url = req.url
    if not url:
        raise HTTPException(400, detail="Missing url")

    async with async_playwright() as p:
        try:
            browser = await p.chromium.launch()
            page = await browser.new_page()
            await page.goto(url, wait_until='networkidle')
            await page.wait_for_timeout(1000)

            text = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('p, h1, h2, h3'))
              .map(el=>el.innerText.trim()).join('\\n\\n')
            }""")
            imgs = await page.evaluate("() => Array.from(document.images).map(i=>i.src)")
            await browser.close()
        except Exception as e:
            raise HTTPException(500, detail=f"Scrape failed: {e}")

    tags = auto_tag(text)
    return { "text": text, "metadata": { "imageLinks": imgs, "tags": tags } }

import requests
import json

def register_mcp():
    mcp_config = {
        "name": "Web Scraper",
        "description": "Fetches and extracts text and image URLs from a web page.",
        "language": "Python",
        "endpoint": "http://localhost:8000/scrape"
    }
    try:
        response = requests.post("http://localhost:8000/register", json=mcp_config)
        response.raise_for_status()
        print("MCP registered successfully.")
    except requests.exceptions.RequestException as e:
        print(f"Failed to register MCP: {e}")

import time

def register_mcp_with_retry(max_retries=5, delay=2):
    mcp_config = {
        "name": "Web Scraper",
        "description": "Fetches and extracts text and image URLs from a web page.",
        "language": "Python",
        "endpoint": "http://localhost:8000/scrape"
    }
    retries = 0
    while retries < max_retries:
        try:
            response = requests.post("http://localhost:8000/register", json=mcp_config)
            response.raise_for_status()
            print("MCP registered successfully.")
            return
        except requests.exceptions.RequestException as e:
            print(f"Failed to register MCP: {e}. Retrying in {delay} seconds...")
            time.sleep(delay)
            retries += 1
    print("Failed to register MCP after multiple attempts.")

import time

time.sleep(5)  # Delay for 5 seconds to allow server to start
register_mcp_with_retry()
