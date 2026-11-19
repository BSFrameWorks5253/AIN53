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
import re
import shutil
import subprocess
import time
import stat
from pathlib import Path

# Ensure Windows terminal UTF-8 encoding for unicode print output
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

def compute_next_version(current: str) -> str:
    parts = current.split('.')
    if len(parts) >= 3:
        try:
            patch = int(parts[-1])
            parts[-1] = str(patch + 1)
            return ".".join(parts)
        except ValueError:
            pass
    try:
        parts = [int(p) for p in parts]
        parts[-1] += 1
        return ".".join(map(str, parts))
    except Exception:
        return current + ".1"

def update_version_in_files(new_version: str, base_dir: Path):
    print(f"=== Synchronizing Version v{new_version} Across Project ===")
    
    # 1. version.txt
    v_file = base_dir / "version.txt"
    v_file.write_text(new_version, encoding='utf-8')
    print(f"  [Updated] version.txt -> {new_version}")

    # 2. frontend/index.html
    html_file = base_dir / "frontend" / "index.html"
    if html_file.exists():
        try:
            content = html_file.read_text(encoding='utf-8', errors='ignore')
            updated = re.sub(r'v\s*\d+\.\d+\.\d+', f'v {new_version}', content)
            html_file.write_text(updated, encoding='utf-8')
            print(f"  [Updated] frontend/index.html -> v {new_version}")
        except Exception as e:
            print(f"  [Error] frontend/index.html: {e}")

    # 3. frontend/js/components/react_components.js
    rc_file = base_dir / "frontend" / "js" / "components" / "react_components.js"
    if rc_file.exists():
        try:
            content = rc_file.read_text(encoding='utf-8', errors='ignore')
            updated = re.sub(r'v\s*\d+\.\d+\.\d+', f'v {new_version}', content)
            rc_file.write_text(updated, encoding='utf-8')
            print(f"  [Updated] frontend/js/components/react_components.js -> v {new_version}")
        except Exception as e:
            print(f"  [Error] frontend/js/components/react_components.js: {e}")

    # 4. installer.py
    inst_file = base_dir / "installer.py"
    if not inst_file.exists():
        inst_file = base_dir / "build_scripts" / "installer.py"
    if inst_file.exists():
        try:
            content = inst_file.read_text(encoding='utf-8', errors='ignore')
            updated = re.sub(r'VERSION\s*=\s*["\']\d+\.\d+\.\d+["\']', f'VERSION = "{new_version}"', content)
            inst_file.write_text(updated, encoding='utf-8')
            print(f"  [Updated] {inst_file.relative_to(base_dir)} -> VERSION = \"{new_version}\"")
        except Exception as e:
            print(f"  [Error] {inst_file}: {e}")

    # 5. Installer HTML templates (Installerv2.html & installer.html)
    for html_name in ["Installerv2.html", "installer.html"]:
        h_path = base_dir / "build_scripts" / html_name
        if h_path.exists():
            try:
                c = h_path.read_text(encoding='utf-8', errors='ignore')
                up = re.sub(r'v\s*\d+\.\d+\.\d+', f'v{new_version}', c)
                h_path.write_text(up, encoding='utf-8')
                print(f"  [Updated] build_scripts/{html_name} -> v{new_version}")
            except Exception as e:
                print(f"  [Error] {html_name}: {e}")

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
def make_zip_safe(source_dir, output_zip_path):
    """
    Safely zip a directory into a zip archive, ignoring broken symlinks (like PyInstaller tzdata leapseconds).
    """
    import zipfile
    source_dir = Path(source_dir)
    output_zip_path = Path(output_zip_path)
    
    with zipfile.ZipFile(output_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for file_path in source_dir.rglob('*'):
            if file_path.is_file() or file_path.is_symlink():
                try:
                    rel_path = file_path.relative_to(source_dir)
                    zf.write(file_path, rel_path)
                except (FileNotFoundError, OSError) as e:
                    print(f"Skipping unreadable item {file_path.name}: {e}")

def main():

    # --------------------------------------------------------------------------
    # 1. OS & VERSION CHECK & SYNC
    # --------------------------------------------------------------------------
    if sys.platform != 'win32':
        print("Warning: This script is intended to run on Windows.")
        print("PyInstaller cannot cross-compile to a Windows executable (.exe) from other operating systems.")
        print("Please run this script on a Windows machine or a Windows Virtual Machine.")

    script_dir = Path(__file__).resolve().parent
    base_dir = script_dir.parent if script_dir.name == "build_scripts" else script_dir
    version_file = base_dir / "version.txt"
    
    if not version_file.exists():
        version_file.write_text("1.0.0")
    
    current_version = version_file.read_text().strip() or "1.0.0"

    # Allow custom version, edition, and output directory from command line args
    target_version = current_version
    edition = "Standard"
    custom_out_dir = None
    skip_upload = False

    for arg in sys.argv[1:]:
        if not arg.startswith('-') and re.match(r'^\d+\.\d+\.\d+$', arg.strip()):
            target_version = arg.strip()
        elif arg.startswith('--version='):
            target_version = arg.split('=', 1)[1].strip()
        elif arg.startswith('--edition='):
            edition = arg.split('=', 1)[1].strip().capitalize()
        elif arg.startswith('--output-dir=') or arg.startswith('--output-path='):
            custom_out_dir = Path(arg.split('=', 1)[1].strip())
        elif arg in ('--no-upload', '--skip-upload', '--no-push'):
            skip_upload = True

    # Check edition.txt if present
    ed_txt = base_dir / "edition.txt"
    if ed_txt.exists():
        try:
            detected_ed = ed_txt.read_text(encoding='utf-8').strip().capitalize()
            if detected_ed in ("Admin", "Standard"):
                edition = detected_ed
        except Exception:
            pass

    # Admin edition strictly never pushes to GitHub
    if edition.lower() == "admin":
        skip_upload = True

    # Synchronize target version across all project files before compilation
    update_version_in_files(target_version, base_dir)
    version = target_version

    print(f"\n=== Starting Professional Windows Build for Version {version} ({edition} Edition) ===")
    if edition.lower() == "admin":
        print("[ADMIN NOTICE] Admin builds are strictly local and will NOT be uploaded to GitHub.")
    
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
    final_build_parent = custom_out_dir if custom_out_dir else (base_dir / "_All Builds" / f"build_v{version}")
    
    # Deleting directories from past compile runs to prevent side-effects
    for path in [dist_dir, build_dir, payload_zip]:
        safe_delete(path)
    if not custom_out_dir:
        safe_delete(final_build_parent)
            
    # Purge old spec files
    for spec_file in base_dir.glob("*.spec"):
        try:
            spec_file.unlink()
        except OSError:
            pass

    # Ensure all required packages are installed in the target interpreter context
    print("Verifying and installing dependencies from requirements.txt...")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(base_dir / "requirements.txt"), "pyinstaller"], check=True)
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
        "--add-data", f"{base_dir / 'frontend'}{os.pathsep}frontend",  # Include GUI files folder
        "--add-data", f"{base_dir / 'version.txt'}{os.pathsep}.",      # Include version file
        "--add-data", f"{base_dir / 'LICENSE'}{os.pathsep}.",          # Include LICENSE file
        str(base_dir / "main.py")
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
    make_zip_safe(output_app_dir, payload_zip)
    if not payload_zip.exists():
        print("Error: Failed to create payload.zip archive!")
        sys.exit(1)
    print(f"Success: Payload archived at: {payload_zip}")


    # --------------------------------------------------------------------------
    # 6. STEP 3: COMPILE WINDOWS GUI INSTALLER
    # --------------------------------------------------------------------------
    print(f"\n--- [Step 3/3] Compiling Standalone Setup GUI ---")
    setup_name = f"AIN53_{edition}_Setup_v{version}"
    
    icon_png = base_dir / 'ICON.png'
    if not icon_png.exists():
        icon_png = base_dir / 'build_scripts' / 'ICON.png'

    inst_script = base_dir / 'build_scripts' / 'installer.py'
    if not inst_script.exists():
        inst_script = base_dir / 'installer.py'

    # Bundle setup script as a single-file executable, embedding payload zip & web UI
    cmd_setup = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",               # Bundle as single independent EXE file
        "--windowed",              # Run installer in windowed UI mode (hide console)
        "--noconfirm",
        "--name", setup_name,
        "--add-data", f"{payload_zip}{os.pathsep}.",   # Embed zipped payload
        "--add-data", f"{base_dir / 'version.txt'}{os.pathsep}.", # Embed version file
        "--add-data", f"{base_dir / 'build_scripts' / 'Installerv2.html'}{os.pathsep}.", # Embed custom HTML setup GUI
        "--add-data", f"{base_dir / 'build_scripts' / 'installer.html'}{os.pathsep}.", # Embed HTML setup GUI fallback
        "--add-data", f"{icon_png}{os.pathsep}frontend", # Embed HTML setup logo asset
        str(inst_script)
    ]
    
    # Embed the icon file resources in the installer binary
    if ico_path.exists():
        cmd_setup.extend([
            "--add-data", f"{ico_path}{os.pathsep}.",
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
    setup_target_exe = final_build_parent / f"{setup_name}.exe"
    shutil.copy2(final_setup_exe, setup_target_exe)
    
    # Create a zipped package of the installer to prevent Windows Defender browser download warnings
    setup_target_zip = final_build_parent / f"{setup_name}.zip"
    import zipfile
    with zipfile.ZipFile(setup_target_zip, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(setup_target_exe, arcname=setup_target_exe.name)
        
    print(f"Success: Installer compiled successfully!")
    print(f"Final installer available at: {setup_target_exe}")

    # --------------------------------------------------------------------------
    # 6b. STEP 4: COMPILE STANDALONE PORTABLE APPLICATION
    # --------------------------------------------------------------------------
    print(f"\n--- [Step 4/4] Compiling Standalone Portable Application ---")
    portable_name = f"AIN53_{edition}_Portable_v{version}"
    
    cmd_portable = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",               # Bundle as single independent EXE file
        "--windowed",              # Run in windowed mode (hide console)
        "--noconfirm",
        "--name", portable_name,
        "--add-data", f"{base_dir / 'frontend'}{os.pathsep}frontend",  # Include GUI files folder
        "--add-data", f"{base_dir / 'version.txt'}{os.pathsep}.",      # Include version file
        "--add-data", f"{base_dir / 'LICENSE'}{os.pathsep}.",          # Include LICENSE file
        str(base_dir / "main.py")
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
    next_version = compute_next_version(version)
    try:
        update_version_in_files(next_version, base_dir)
        print(f"Incremented version: {version} -> {next_version} (synced across codebase)")
    except Exception as e:
        print(f"Failed to increment version: {e}")

    # --------------------------------------------------------------------------
    # 9. AUTOMATED GITHUB RELEASE UPLOAD & NOTIFICATION
    # --------------------------------------------------------------------------
    no_upload = "--no-upload" in sys.argv or "--no-push" in sys.argv or os.environ.get("NO_GITHUB_UPLOAD") == "1" or skip_upload or edition.lower() == "admin"
    if no_upload:
        if edition.lower() == "admin":
            print("\n[ADMIN NOTICE] Skipping GitHub Release Upload (Admin Edition is strictly kept local).")
        else:
            print("\n[NOTE] Skipping GitHub Release Upload (Local Build mode).")
    else:
        publish_to_github(
            base_dir=base_dir,
            current_version=version,
            next_version=next_version,
            setup_exe=setup_target_exe,
            setup_zip=setup_target_zip,
            portable_exe=final_build_parent / f"{portable_name}.exe",
            edition=edition
        )

        
    print("\n=== Windows Build Process Complete! ===")

def publish_to_github(base_dir, current_version, next_version, setup_exe, portable_exe, setup_zip=None, edition="Standard"):
    """
    Automates uploading build artifacts and pushing git tag to GitHub
    so the app instantly receives update notifications.
    """
    if hasattr(sys.stdout, 'reconfigure'):
        try:
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass

    if edition.lower() == "admin":
        print("\n[ADMIN NOTICE] Admin builds are not published to GitHub.")
        return True

    print("\n--- [Step 5/5] Publishing Standard Release to GitHub ---")
    repo = os.environ.get("GITHUB_REPO") or os.environ.get("Repo_name") or "BSFrameWorks5253/AIN53"
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    
    # Check .env file if environment variables are not explicitly set
    env_file = base_dir / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding='utf-8', errors='ignore').splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k_clean = k.strip().upper()
            v_clean = v.strip().strip("'\"")
            if k_clean in ["GITHUB_REPO", "REPO_NAME"] and v_clean:
                if "/" not in v_clean:
                    v_clean = f"BSFrameWorks5253/{v_clean}"
                repo = v_clean
            elif not token and (k_clean in ["TOKEN", "GITHUB_TOKEN", "GH_TOKEN"] or v_clean.startswith("ghp_") or v_clean.startswith("github_pat_")):
                token = v_clean

    tag = f"v{current_version}"

    # 1. Direct GitHub REST API upload via GITHUB_TOKEN / .env if available
    if token:
        try:
            import urllib.request
            import urllib.error
            import json
            
            print(f"Uploading release {tag} to GitHub via REST API...")
            rel_url = f"https://api.github.com/repos/{repo}/releases"
            payload = json.dumps({
                "tag_name": tag,
                "target_commitish": "main",
                "name": f"v{current_version}",
                "body": f"Automated Release build {tag}.\n\nSetup and Portable executables attached.",
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
            rel_data = None
            try:
                with urllib.request.urlopen(req) as resp:
                    rel_data = json.loads(resp.read().decode('utf-8'))
            except urllib.error.HTTPError as he:
                if he.code == 422:
                    # Release already exists, get existing release details
                    tag_url = f"https://api.github.com/repos/{repo}/releases/tags/{tag}"
                    tag_req = urllib.request.Request(
                        tag_url,
                        headers={
                            "Authorization": f"token {token}",
                            "Accept": "application/vnd.github.v3+json",
                            "User-Agent": "AIN53-Publisher"
                        }
                    )
                    with urllib.request.urlopen(tag_req) as tag_resp:
                        rel_data = json.loads(tag_resp.read().decode('utf-8'))
                else:
                    raise he

            upload_url_template = rel_data.get("upload_url", "")
            upload_url = upload_url_template.split("{")[0]
            existing_assets = {a.get("name"): a.get("id") for a in rel_data.get("assets", [])}
            
            upload_files = [f for f in [setup_exe, setup_zip, portable_exe] if f and f.exists()]
            for exe_file in upload_files:
                if exe_file.name in existing_assets:
                    del_id = existing_assets[exe_file.name]
                    print(f"Replacing existing asset: {exe_file.name} (ID: {del_id})...")
                    del_url = f"https://api.github.com/repos/{repo}/releases/assets/{del_id}"
                    del_req = urllib.request.Request(
                        del_url,
                        headers={
                            "Authorization": f"token {token}",
                            "User-Agent": "AIN53-Publisher"
                        },
                        method="DELETE"
                    )
                    try:
                        with urllib.request.urlopen(del_req):
                            pass
                    except Exception:
                        pass

                size_mb = exe_file.stat().st_size / (1024 * 1024)
                print(f"Uploading asset: {exe_file.name} ({size_mb:.1f} MB) to GitHub Release...")
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
                    print(f"[OK] Successfully uploaded {exe_file.name} to GitHub Release!")
            print(f"[SUCCESS] GitHub Release {tag} published successfully!")
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
                "--title", f"v{current_version}",
                "--notes", f"Official Release build {tag}."
            ]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0:
                print(f"[SUCCESS] GitHub Release {tag} published via GitHub CLI!")
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
            subprocess.run(["git", "tag", "-f", "-a", tag, "-m", f"Release {tag}"], cwd=base_dir, check=False)
            push_res = subprocess.run(["git", "push", "origin", "main", tag], capture_output=True, text=True, cwd=base_dir)
            
            if push_res.returncode == 0:
                print(f"[SUCCESS] Git tag {tag} and main branch pushed to GitHub successfully!")
                return True
            else:
                print(f"\n[WARNING] Git push returned an error:\n{push_res.stderr.strip()}")
        else:
            print("\n[NOTE] For Automatic GitHub Uploads:")
            print("  1. Set GITHUB_TOKEN environment variable in your system")
            print("  2. Install GitHub CLI (gh)")
    except Exception as e:
        print(f"Warning: Git check/push failed: {e}")

    return False



if __name__ == '__main__':
    main()

