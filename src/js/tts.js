// Metinden sese: Windows'un yüklü sesleri (OneCore/WinRT, ör. "Microsoft Tolga" Türkçe; ve klasik SAPI sesleri).
// PowerShell betiği çalışma anında geçici klasöre yazılır; metin UTF-8 dosyayla aktarılır (Türkçe karakterler bozulmasın).
import { childProcess, nodeFs, nodePath, ensureDir } from './util.js';
import { ff } from './ffmpeg.js';

const PS = String.raw`param([string]$TextFile = '', [string]$Voice = '', [string]$Out = '', [double]$Rate = 1.0, [switch]$List)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$winrt = $true
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
} catch { $winrt = $false }
Add-Type -AssemblyName System.Speech
if ($List) {
  if ($winrt) { [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object { "W|$($_.DisplayName)|$($_.Language)|$($_.Gender)" } }
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.GetInstalledVoices() | ForEach-Object { "S|$($_.VoiceInfo.Name)|$($_.VoiceInfo.Culture)|$($_.VoiceInfo.Gender)" }
  exit 0
}
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
if ($Voice.StartsWith('S|')) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice($Voice.Substring(2))
  $s.Rate = [int][Math]::Max(-10, [Math]::Min(10, [Math]::Round(($Rate - 1) * 10)))
  $s.SetOutputToWaveFile($Out)
  $s.Speak($text)
  $s.Dispose()
  "OK"; exit 0
}
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait() | Out-Null; $task.Result }
$syn = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$name = $Voice.Substring(2)
$v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -eq $name } | Select-Object -First 1
if ($v) { $syn.Voice = $v }
$syn.Options.SpeakingRate = [Math]::Max(0.5, [Math]::Min(3.0, $Rate))
$stream = Await ($syn.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
$n = [uint32]$stream.Size
$null = Await ($reader.LoadAsync($n)) ([uint32])
$bytes = New-Object byte[] $n
$reader.ReadBytes($bytes)
[System.IO.File]::WriteAllBytes($Out, $bytes)
"OK"
`;

function script() {
  const dir = ensureDir(nodePath.join(ff.cacheDir, 'tts'));
  const f = nodePath.join(dir, 'uli_tts.ps1');
  // UTF-8 BOM: Windows PowerShell 5.1 betiği doğru kodlamayla okusun
  const body = '﻿' + PS;
  if (!nodeFs.existsSync(f) || nodeFs.readFileSync(f, 'utf8') !== body) nodeFs.writeFileSync(f, body, 'utf8');
  return f;
}

function ps(args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script(), ...args], { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).split('\n').slice(-4).join('\n'))); else resolve(stdout);
    });
  });
}

let voicesCache = null;
// [{ id: 'W|Microsoft Tolga', name, lang, gender }]
export function listVoices() {
  if (!voicesCache) {
    voicesCache = ps(['-List']).then((out) => out.split(/\r?\n/).filter((l) => /^[WS]\|/.test(l)).map((l) => {
      const [k, name, lang, gender] = l.split('|');
      return { id: k + '|' + name, name, lang, gender };
    })).catch(() => []);
  }
  return voicesCache;
}

// Metni WAV dosyasına seslendir; dosya yolunu döndürür
export async function synthesize(text, voiceId, rate, outFile) {
  const dir = ensureDir(nodePath.join(ff.cacheDir, 'tts'));
  const tf = nodePath.join(dir, 'tts_' + Date.now() + '.txt');
  nodeFs.writeFileSync(tf, text, 'utf8');
  try {
    await ps(['-TextFile', tf, '-Voice', voiceId, '-Out', outFile, '-Rate', String(rate)]);
  } finally { try { nodeFs.unlinkSync(tf); } catch (e) { /* */ } }
  if (!nodeFs.existsSync(outFile) || nodeFs.statSync(outFile).size < 100) throw new Error('TTS failed');
  return outFile;
}
