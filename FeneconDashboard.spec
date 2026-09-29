# PyInstaller-Bauanleitung für die Windows-.exe:  pyinstaller FeneconDashboard.spec
# Ergebnis: dist/FeneconDashboard.exe (eine Datei, Konsolenfenster mit Statusausgabe)

a = Analysis(
    ["server.py"],
    datas=[("static", "static"), ("config.example.json", ".")],
    excludes=["tkinter", "unittest", "pydoc", "test"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="FeneconDashboard",
    console=True,
    upx=False,
    icon="windows/icon.ico" if __import__("os").path.exists("windows/icon.ico") else None,
)
