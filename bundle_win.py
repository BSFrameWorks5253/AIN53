"""
Windows Packaging & Installer Builder Script
============================================

This script automates compiling AIN53 Data Management into a professional native executable
and packaging it into a GUI Setup Installer.

Process Flow:
1. Checks for Windows environment compatibility and retrieves/configures versioning.
2. Formats and validates custom system icons (converting icon.icns to icon.ico if needed).
3. Clears previous temporary artifacts, spec configurations, and dist folders.
4. Compiles main.py to a folder bundle using PyInstaller: dist/AIN53 Data Management/
5. Compresses the application bundle folder into a flat payload: payload.zip
6. Compiles installer.py into a single-file executable, embedding payload.zip and the icon.
7. Places the completed AIN53_Data_Management_Setup.exe into "_All Builds/build_X.Y.Z/".
8. Cleans all temporary items and increments the build version patch.
"""
import os
import sys
import shutil
import subprocess
import time
import stat
from pathlib import Path

def safe_delete(path, retries=5, delay=0.5):
    """
    Safely delete a directory or file, retrying on PermissionError (common on Windows
    when files are temporarily locked by antivirus or the OS) and handling read-only files.
    """
    path = Path(path)
    if not path.exists():
        return True

    def remove_readonly(func, file_path, exc_info):
        try:
            os.chmod(file_path, stat.S_IWRITE)
            func(file_path)
        except Exception:
            pass

    for attempt in range(retries):
        try:
            if path.is_dir():
                try:
                    shutil.rmtree(path, onexc=remove_readonly)
                except TypeError:
                    shutil.rmtree(path, onerror=remove_readonly)
            else:
                try:
                    os.chmod(path, stat.S_IWRITE)
                except Exception:
                    pass
                path.unlink()
            return True
        except PermissionError as e:
            if attempt < retries - 1:
                print(f"Path {path.name} is locked, retrying in {delay}s... (Attempt {attempt+1}/{retries})")
                time.sleep(delay)
            else:
                print(f"Warning: Permission denied for deleting {path}: {e}")
                return False
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(delay)
            else:
                print(f"Warning: Failed to delete {path}: {e}")
                return False

def main():
    # --------------------------------------------------------------------------
    # 1. OS & VERSION CHECK
    # --------------------------------------------------------------------------
    if sys.platform != 'win32':
        print("⚠️  Warning: This script is intended to run on Windows.")
        print("PyInstaller cannot cross-compile to a Windows executable (.exe) from other operating systems.")
        print("Please run this script on a Windows machine or a Windows Virtual Machine.")

    base_dir = Path(__file__).resolve().parent
    version_file = base_dir / "version.txt"
    
    if not version_file.exists():
        version_file.write_text("1.0.0")
    
    version = version_file.read_text().strip()
    print(f"=== Starting Professional Windows Build for Version {version} ===")
    
    # --------------------------------------------------------------------------
    # 2. ICON COMPILATION
    # --------------------------------------------------------------------------
    ico_path = base_dir / "icon.ico"
    icns_path = base_dir / "icon.icns"
    if not ico_path.exists():
        print("icon.ico not found. Attempting to convert icon.icns to icon.ico...")
        if icns_path.exists():
            try:
                from PIL import Image
                img = Image.open(icns_path)
                # Export ICO format embedding standard dimensions for Windows shell
                img.save(ico_path, format='ICO', sizes=[(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)])
                print("Successfully generated icon.ico from icon.icns!")
            except Exception as e:
                print(f"Could not convert icon.icns: {e}")
                print("Will proceed without an icon.")
        else:
            print("icon.icns not found either. Will proceed without an icon.")

    # --------------------------------------------------------------------------
    # 3. BUILD PATH CLEANUP
    # --------------------------------------------------------------------------
    dist_dir = base_dir / "dist"
    build_dir = base_dir / "build"
    payload_zip = base_dir / "payload.zip"
    final_build_parent = base_dir / "_All Builds" / f"build_{version}"
    
    # Deleting directories from past compile runs to prevent side-effects
    for path in [dist_dir, build_dir, final_build_parent, payload_zip]:
        safe_delete(path)
            
    # Purge old spec files
    for spec_file in base_dir.glob("*.spec"):
        try:
            spec_file.unlink()
        except OSError:
            pass

    # Ensure all required packages are installed in the target interpreter context
    print("Verifying and installing dependencies from requirements.txt...")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "pyinstaller"], check=True)
    except Exception as e:
        print(f"Warning: Failed to verify requirements: {e}")

    # --------------------------------------------------------------------------
    # 4. STEP 1: COMPILE MAIN APPLICATION PORTABLE BUNDLE
    # --------------------------------------------------------------------------
    app_name = "AIN53 Data Management"
    print(f"\n--- [Step 1/3] Compiling Main Application Bundle ---")
    
    cmd_app = [
        sys.executable, "-m", "PyInstaller",
        "--windowed",              # Run in windowed mode (hide console window)
        "--noconfirm",             # Overwrite folder targets without prompt
        "--name", app_name,
        "--add-data", f"frontend{os.pathsep}frontend",  # Include GUI files folder
        "--add-data", f"version.txt{os.pathsep}.",      # Include version file
        "--add-data", f"LICENSE{os.pathsep}.",          # Include LICENSE file
        "main.py"
    ]
    
    if ico_path.exists():
        cmd_app.extend(["--icon", str(ico_path)])
        
    print(f"Running command: {' '.join(cmd_app)}")
    subprocess.run(cmd_app, check=True)
    
    # Verify main bundle compilation
    output_app_dir = dist_dir / app_name
    if not output_app_dir.exists():
        print("Error: PyInstaller application bundle folder was not created!")
        sys.exit(1)
    print("Success: Generated main application portable bundle.")

    # --------------------------------------------------------------------------
    # 5. STEP 2: COMPRESS APP BUNDLE INTO PAYLOAD ZIP
    # --------------------------------------------------------------------------
    print(f"\n--- [Step 2/3] Compressing Application Payload into ZIP ---")
    shutil.make_archive(str(base_dir / "payload"), 'zip', output_app_dir)
    if not payload_zip.exists():
        print("Error: Failed to create payload.zip archive!")
        sys.exit(1)
    print(f"Success: Payload archived at: {payload_zip}")

    # --------------------------------------------------------------------------
    # 6. STEP 3: COMPILE WINDOWS GUI INSTALLER
    # --------------------------------------------------------------------------
    print(f"\n--- [Step 3/3] Compiling Standalone Setup GUI ---")
    setup_name = f"AIN53_Data_Management_Setup"
    
    # Bundle setup script as a single-file executable, embedding the payload zip
    cmd_setup = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",               # Bundle as single independent EXE file
        "--windowed",              # Run installer in windowed UI mode (hide console)
        "--noconfirm",
        "--name", setup_name,
        "--add-data", f"payload.zip{os.pathsep}.",   # Embed zipped payload
        "--add-data", f"version.txt{os.pathsep}.",   # Embed version metadata file
        "installer.py"
    ]
    
    # Embed the icon file resources in the installer binary
    if ico_path.exists():
        cmd_setup.extend([
            "--add-data", f"icon.ico{os.pathsep}.",
            "--icon", str(ico_path)
        ])
        
    print(f"Running command: {' '.join(cmd_setup)}")
    subprocess.run(cmd_setup, check=True)

    # Verify setup executable creation
    final_setup_exe = dist_dir / f"{setup_name}.exe"
    if not final_setup_exe.exists():
        print("Error: Setup installer compilation failed!")
        sys.exit(1)
        
    # Create final builds storage folder
    final_build_parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(final_setup_exe, final_build_parent / f"{setup_name}.exe")
    print(f"Success: Installer compiled successfully!")
    print(f"Final installer available at: {final_build_parent / f'{setup_name}.exe'}")

    # --------------------------------------------------------------------------
    # 6b. STEP 4: COMPILE STANDALONE PORTABLE APPLICATION
    # --------------------------------------------------------------------------
    print(f"\n--- [Step 4/4] Compiling Standalone Portable Application ---")
    portable_name = f"AIN53_Data_Management_Portable"
    
    cmd_portable = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",               # Bundle as single independent EXE file
        "--windowed",              # Run in windowed mode (hide console)
        "--noconfirm",
        "--name", portable_name,
        "--add-data", f"frontend{os.pathsep}frontend",  # Include GUI files folder
        "main.py"
    ]
    
    if ico_path.exists():
        cmd_portable.extend(["--icon", str(ico_path)])
        
    print(f"Running command: {' '.join(cmd_portable)}")
    subprocess.run(cmd_portable, check=True)
    
    # Verify portable executable creation
    final_portable_exe = dist_dir / f"{portable_name}.exe"
    if not final_portable_exe.exists():
        print("Error: Portable application compilation failed!")
        sys.exit(1)
        
    # Copy to the final builds storage folder
    shutil.copy2(final_portable_exe, final_build_parent / f"{portable_name}.exe")
    print(f"Success: Standalone Portable EXE compiled successfully!")
    print(f"Final Portable available at: {final_build_parent / f'{portable_name}.exe'}")

    # --------------------------------------------------------------------------
    # 7. CLEANUP OF WORKSPACE TEMP ITEMS
    # --------------------------------------------------------------------------
    print("\nCleaning up temporary compile folders...")
    safe_delete(dist_dir)
    safe_delete(build_dir)
    safe_delete(payload_zip)
    for spec_file in base_dir.glob("*.spec"):
        try:
            spec_file.unlink()
        except OSError:
            pass

    # --------------------------------------------------------------------------
    # 8. VERSION AUTO-INCREMENT
    # --------------------------------------------------------------------------
    next_version = version
    try:
        parts = version.split('.')
        parts[-1] = str(int(parts[-1]) + 1)
        next_version = '.'.join(parts)
        version_file.write_text(next_version)
        print(f"Incremented version: {version} -> {next_version} (saved to version.txt)")
    except Exception as e:
        print(f"Failed to increment version: {e}")

    # --------------------------------------------------------------------------
    # 9. AUTOMATED GITHUB RELEASE UPLOAD & NOTIFICATION
    # --------------------------------------------------------------------------
    publish_to_github(
        base_dir=base_dir,
        current_version=version,
        next_version=next_version,
        setup_exe=final_build_parent / f"{setup_name}.exe",
        portable_exe=final_build_parent / f"{portable_name}.exe"
    )
        
    print("\n=== Windows Build & Release Process Complete! ===")

def publish_to_github(base_dir, current_version, next_version, setup_exe, portable_exe):
    """
    Automates uploading build artifacts and pushing git tag to GitHub
    so the app instantly receives update notifications.
    """
    print("\n--- [Step 5/5] Publishing Release to GitHub ---")
    repo = "BSFrameWorks5253/AIN53"
    tag = f"v{current_version}"
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    
    # Check .env file if environment variable is not explicitly set
    if not token:
        env_file = base_dir / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding='utf-8', errors='ignore').splitlines():
                line = line.strip()
                if line.startswith("ghp_") or line.startswith("github_pat_"):
                    token = line
                    break
                elif "=" in line:
                    k, v = line.split("=", 1)
                    if k.strip() in ["GITHUB_TOKEN", "GH_TOKEN"]:
                        token = v.strip().strip("'\"")
                        break

    # 1. Direct GitHub REST API upload via GITHUB_TOKEN / .env if available

    if token:
        try:
            import urllib.request
            import json
            
            print(f"Uploading release {tag} to GitHub via REST API...")
            rel_url = f"https://api.github.com/repos/{repo}/releases"
            payload = json.dumps({
                "tag_name": tag,
                "target_commitish": "main",
                "name": f"Release {tag}",
                "body": f"Automated Release build {tag}. Setup and Portable executables attached.",
                "draft": False,
                "prerelease": False
            }).encode('utf-8')
            
            req = urllib.request.Request(
                rel_url,
                data=payload,
                headers={
                    "Authorization": f"token {token}",
                    "Accept": "application/vnd.github.v3+json",
                    "Content-Type": "application/json",
                    "User-Agent": "AIN53-Publisher"
                },
                method="POST"
            )
            with urllib.request.urlopen(req) as resp:
                rel_data = json.loads(resp.read().decode('utf-8'))
                upload_url_template = rel_data.get("upload_url", "")
                
            upload_url = upload_url_template.split("{")[0]
            
            for exe_file in [setup_exe, portable_exe]:
                if exe_file.exists():
                    print(f"Uploading asset: {exe_file.name} to GitHub Release...")
                    file_data = exe_file.read_bytes()
                    asset_req = urllib.request.Request(
                        f"{upload_url}?name={exe_file.name}",
                        data=file_data,
                        headers={
                            "Authorization": f"token {token}",
                            "Content-Type": "application/octet-stream",
                            "User-Agent": "AIN53-Publisher"
                        },
                        method="POST"
                    )
                    with urllib.request.urlopen(asset_req):
                        print(f"✅ Successfully uploaded {exe_file.name} to GitHub!")
            print(f"✨ GitHub Release {tag} published successfully!")
            return True
        except Exception as e:
            print(f"Warning: GitHub REST API upload failed: {e}")

    # 2. Try GitHub CLI (gh) if installed
    try:
        gh_check = subprocess.run(["gh", "--version"], capture_output=True, text=True)
        if gh_check.returncode == 0:
            print(f"Creating GitHub Release {tag} using GitHub CLI (gh)...")
            cmd = [
                "gh", "release", "create", tag,
                str(setup_exe),
                str(portable_exe),
                str(base_dir / "version.txt"),
                "--title", f"Release {tag}",
                "--notes", f"Automated Release build {tag}."
            ]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0:
                print(f"✨ GitHub Release {tag} published via GitHub CLI!")
                return True
            else:
                print(f"Warning: GitHub CLI release failed: {res.stderr}")
    except Exception:
        pass

    # 3. Try Git auto-commit and tag push
    try:
        git_check = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], capture_output=True, text=True, cwd=base_dir)
        if git_check.returncode == 0:
            print(f"Publishing Git tag {tag} to GitHub...")
            subprocess.run(["git", "add", "."], cwd=base_dir, check=False)
            subprocess.run(["git", "commit", "-m", f"Release build {tag}"], cwd=base_dir, check=False)
            subprocess.run(["git", "tag", "-a", tag, "-m", f"Release {tag}"], cwd=base_dir, check=False)
            push_res = subprocess.run(["git", "push", "origin", "main", "--tags"], capture_output=True, text=True, cwd=base_dir)
            
            if push_res.returncode == 0:
                print(f"✨ Git tag {tag} and main branch pushed to GitHub successfully!")
                print("⚡ GitHub Actions workflow is now compiling and publishing the release assets!")
                return True
            else:
                print(f"\n⚠️  Git push returned an error:\n{push_res.stderr.strip()}")
                if "workflow" in push_res.stderr:
                    print("\n🔑 SOLUTION FOR WORKFLOW PERMISSION ERROR:")
                    print("Your GitHub token needs the 'workflow' scope permission.")
                    print("1. Go to GitHub -> Settings -> Developer Settings -> Personal Access Tokens (Classic).")
                    print("2. Edit your token and check the 'workflow' checkbox.")
                    print("3. Save token and run `git push origin main --tags` in your terminal.")
        else:
            print("\n💡 Note for Automatic GitHub Uploads:")
            print("  1. Set GITHUB_TOKEN environment variable in your system: $env:GITHUB_TOKEN='your_github_pat'")
            print("  2. Install GitHub CLI (gh) and run 'gh auth login'")
            print("  3. Initialize Git repository (`git init`) and set remote to https://github.com/BSFrameWorks5253/AIN53.git")
    except Exception as e:
        print(f"Warning: Git check/push failed: {e}")

    return False


if __name__ == '__main__':
    main()

