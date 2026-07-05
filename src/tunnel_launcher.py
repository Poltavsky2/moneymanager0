import subprocess
import re
import os
import sys
import time

def run_tunnel():
    cmd = [
        "ssh", 
        "-p", "443", 
        "-R0:localhost:3000", 
        "-o", "StrictHostKeyChecking=no", 
        "-o", "UserKnownHostsFile=/dev/null", 
        "-o", "BatchMode=yes",
        "-o", "ServerAliveInterval=30", 
        "qr@a.pinggy.io"
    ]

    print("Starting SSH tunnel using pinggy.io...", flush=True)
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

    url = None
    for line in process.stdout:
        stripped_line = line.strip()
        print(f"[Tunnel Output]: {stripped_line}", flush=True)
        
        # Look for pinggy URL
        match = re.search(r'https?://[a-zA-Z0-9.-]+\.(?:pinggy\.link|pinggy\.net|pinggy-free\.link)', stripped_line)
        if match:
            url = match.group(0)
            if url.startswith("http://"):
                url = "https://" + url[7:]
            print(f"FOUND TUNNEL URL: {url}", flush=True)
            
            # Write to .env
            env_path = os.path.join(os.path.dirname(__file__), ".env")
            if os.path.exists(env_path):
                with open(env_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                # Replace WEB_APP_URL
                pattern = r'WEB_APP_URL=.*'
                if re.search(pattern, content):
                    new_content = re.sub(pattern, f'WEB_APP_URL={url}', content)
                else:
                    new_content = content + f'\nWEB_APP_URL={url}\n'
                    
                with open(env_path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                print("Successfully updated .env with new WEB_APP_URL", flush=True)
            else:
                print(".env file not found!", flush=True)
            break

    # Keep reading and printing log in the background
    for line in process.stdout:
        if line.strip():
            print(f"[Tunnel Log]: {line.strip()}", flush=True)
            
    # Wait for process to exit and get status
    returncode = process.wait()
    print(f"Tunnel process terminated with code {returncode}", flush=True)

def main():
    while True:
        try:
            run_tunnel()
        except Exception as e:
            print(f"Error running tunnel: {e}", flush=True)
        print("Re-establishing tunnel in 5 seconds...", flush=True)
        time.sleep(5)

if __name__ == "__main__":
    main()
