# l18n-lqa

Linguistic Quality Assessment (LQA) test platform. Candidates complete a timed, multi-page assessment in their target language. Answers are submitted to a Teams webhook.

## Structure

```
src/
  index.html       # Main application shell
  css/style.css    # All styles
  js/app.js        # All application logic
tools/
  build_data.py    # Generates l18n/lqa-data.json from lqa-textes-i18n.xlsx
  build_data.spec  # PyInstaller spec for build_data.exe
  install_build_data.bat   # One-click setup (Windows)
  install_build_data.ps1   # PowerShell equivalent
l18n/              # Generated data files (lqa-data.json)
screenshots/       # Screenshot assets used in assessment questions
```

## Setup

Run `tools\install_build_data.bat` to install Python dependencies and compile `build_data.exe`. Then run `build_data.exe` to regenerate `l18n/lqa-data.json` from the source spreadsheet.

Open `src/index.html` in a browser to use the assessment.

## To-do

- [ ] **Token — step 3:** URL-based access control (`?token=…` in invitation link — blocks unauthorized access at page load).
- [ ] **Token — step 4:** Offline admin link generator (depends on step 3).
- [ ] **Token — step 5:** Mark token as consumed after submission (anti-replay beyond BroadcastChannel).
