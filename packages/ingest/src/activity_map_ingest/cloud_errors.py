def failure_detail(error: Exception) -> str:
    """Keep the actionable schema failure instead of Ray's wrapper traceback."""
    text = str(error)
    for line in reversed(text.splitlines()):
        stripped = line.strip()
        if '"error":' in stripped:
            return stripped.split('"error":', 1)[1].strip().strip(',"')[:500]
    return text.splitlines()[-1][:500] if text.splitlines() else type(error).__name__
