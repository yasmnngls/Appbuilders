# Generates benchmark speech offline with Windows SAPI, written directly as 16 kHz 16-bit mono WAV.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/whisper-tts.ps1 -Text "..." -Out file.wav [-Rate 0]
param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Rate = 0
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = $Rate
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile($Out, $fmt)
$synth.Speak($Text)
$synth.Dispose()
Write-Output "$($synth.Voice.Name) -> $Out"
