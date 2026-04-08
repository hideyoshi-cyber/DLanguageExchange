// ============================================
// DLanguageExchange — App Core (Part 1: Managers)
// ============================================

(() => {
  'use strict';

  // --- Language Config ---
  const LANGUAGES = {
    'ja-JP': { translate: 'ja', label: '日本語', badge: 'JA', flag: '🇯🇵' },
    'en-US': { translate: 'en', label: 'English', badge: 'EN', flag: '🇺🇸' },
    'ko-KR': { translate: 'ko', label: '한국어', badge: 'KO', flag: '🇰🇷' },
    'fr-FR': { translate: 'fr', label: 'Français', badge: 'FR', flag: '🇫🇷' }
  };

  // =====================
  // Toast Manager
  // =====================
  const Toast = {
    el: null,
    textEl: null,
    timeout: null,
    init() {
      this.el = document.getElementById('toast');
      this.textEl = document.getElementById('toast-text');
    },
    show(msg, type = 'info', duration = 3000) {
      if (!this.el) return;
      clearTimeout(this.timeout);
      this.textEl.textContent = msg;
      this.el.className = `toast toast--visible toast--${type}`;
      this.timeout = setTimeout(() => {
        this.el.classList.remove('toast--visible');
      }, duration);
    }
  };

  // =====================
  // Translation Manager
  // =====================
  const TranslationManager = {
    cache: new Map(),
    charCount: 0,

    async translate(text, sourceLang, targetLang) {
      if (!text.trim()) return '';
      const key = `${text}|${sourceLang}|${targetLang}`;
      if (this.cache.has(key)) return this.cache.get(key);

      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.responseStatus === 200 && data.responseData) {
          const translated = data.responseData.translatedText;
          this.cache.set(key, translated);
          this.charCount += text.length;
          this.updateUsageDisplay();
          return translated;
        }
        throw new Error(data.responseDetails || 'Translation failed');
      } catch (err) {
        console.error('Translation error:', err);
        Toast.show(`翻訳エラー: ${err.message}`, 'error');
        return `[翻訳エラー] ${text}`;
      }
    },

    updateUsageDisplay() {
      const el = document.getElementById('api-usage');
      if (el) el.textContent = `${this.charCount.toLocaleString()} / 5,000 文字`;
    }
  };

  // =====================
  // TTS Manager (Queue-based + Auto Ducking)
  // =====================
  const TTSManager = {
    queue: [],
    isSpeaking: false,
    speed: 1.0,
    pitch: 1.0,
    autoPlay: true,
    synthesis: window.speechSynthesis,
    selectedVoice: null,
    voices: [],
    statusEl: null,
    statusTextEl: null,
    queueCountEl: null,
    MAX_QUEUE: 3,

    init() {
      this.statusEl = document.getElementById('tts-status');
      this.statusTextEl = document.getElementById('tts-status-text');
      this.queueCountEl = document.getElementById('tts-queue-count');

      // Load available voices
      this._loadVoices();
      // Chrome needs onvoiceschanged
      this.synthesis.onvoiceschanged = () => this._loadVoices();
    },

    _loadVoices() {
      this.voices = this.synthesis.getVoices();
      const select = document.getElementById('voice-select');
      if (!select || this.voices.length === 0) return;

      // Clear existing options
      select.innerHTML = '<option value="">自動（最適な音声を選択）</option>';

      // Group voices by language
      const langGroups = {
        'ja': { label: '🇯🇵 日本語', voices: [] },
        'en': { label: '🇺🇸 English', voices: [] },
        'ko': { label: '🇰🇷 한국어', voices: [] },
        'fr': { label: '🇫🇷 Français', voices: [] }
      };

      this.voices.forEach((voice, idx) => {
        const langCode = voice.lang.substring(0, 2);
        if (langGroups[langCode]) {
          // Prioritize natural/online voices
          const isNatural = voice.name.includes('Natural') || voice.name.includes('Online') || voice.name.includes('Neural');
          langGroups[langCode].voices.push({ voice, idx, isNatural });
        }
      });

      // Create optgroups
      Object.entries(langGroups).forEach(([code, group]) => {
        if (group.voices.length === 0) return;
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.label;

        // Sort: natural voices first
        group.voices.sort((a, b) => (b.isNatural ? 1 : 0) - (a.isNatural ? 1 : 0));

        group.voices.forEach(({ voice, idx, isNatural }) => {
          const option = document.createElement('option');
          option.value = idx;
          option.textContent = `${isNatural ? '⭐ ' : ''}${voice.name}`;
          optgroup.appendChild(option);
        });

        select.appendChild(optgroup);
      });
    },

    // Find best voice for a given language
    _getBestVoice(lang) {
      if (this.selectedVoice) return this.selectedVoice;

      const langCode = lang.substring(0, 2);
      // Prefer natural/neural voices
      const natural = this.voices.find(v =>
        v.lang.startsWith(langCode) &&
        (v.name.includes('Natural') || v.name.includes('Online') || v.name.includes('Neural'))
      );
      if (natural) return natural;

      // Fallback to any matching voice
      return this.voices.find(v => v.lang.startsWith(langCode)) || null;
    },

    setVoice(voiceIndex) {
      if (voiceIndex === '' || voiceIndex === null) {
        this.selectedVoice = null; // Auto mode
      } else {
        this.selectedVoice = this.voices[parseInt(voiceIndex)] || null;
      }
    },

    enqueue(text, lang) {
      if (!this.autoPlay || !text.trim()) return;
      while (this.queue.length >= this.MAX_QUEUE) {
        const skipped = this.queue.shift();
        console.warn('TTS queue overflow, skipping:', skipped.text.substring(0, 30));
      }
      this.queue.push({ text, lang });
      this.updateUI();
      if (!this.isSpeaking) this.processNext();
    },

    processNext() {
      if (this.queue.length === 0) {
        this.isSpeaking = false;
        SpeechManager.restoreUserVolume();
        this.updateUI();
        return;
      }
      this.isSpeaking = true;
      const { text, lang } = this.queue.shift();
      this.updateUI();

      SpeechManager.duckVolume();
      this.synthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = this.speed;
      utterance.pitch = this.pitch;
      utterance.volume = 1.0;

      // Apply selected or best voice
      const voice = this._getBestVoice(lang);
      if (voice) utterance.voice = voice;

      utterance.onend = () => {
        setTimeout(() => this.processNext(), 100);
      };
      utterance.onerror = (e) => {
        console.error('TTS error:', e);
        setTimeout(() => this.processNext(), 100);
      };

      this.synthesis.speak(utterance);
    },

    stop() {
      this.synthesis.cancel();
      this.queue = [];
      this.isSpeaking = false;
      SpeechManager.restoreUserVolume();
      this.updateUI();
    },

    setSpeed(val) { this.speed = val; },
    setPitch(val) { this.pitch = val; },

    toggleAuto() {
      this.autoPlay = !this.autoPlay;
      if (!this.autoPlay) this.stop();
      return this.autoPlay;
    },

    updateUI() {
      if (!this.statusEl) return;
      const total = this.queue.length + (this.isSpeaking ? 1 : 0);
      if (total > 0) {
        this.statusEl.classList.remove('hidden');
        this.statusTextEl.textContent = this.isSpeaking ? '🔊 読み上げ中（元音声↓）' : '待機中';
        this.queueCountEl.textContent = `キュー: ${this.queue.length}`;
      } else {
        this.statusEl.classList.add('hidden');
      }
    }
  };

  // =====================
  // Audio Level Visualizer
  // =====================
  const AudioLevel = {
    context: null,
    analyser: null,
    source: null,
    bars: [],
    barFills: [],
    animFrame: null,
    BAR_COUNT: 24,

    init() {
      const container = document.getElementById('audio-bars');
      if (!container) return;
      container.innerHTML = '';
      for (let i = 0; i < this.BAR_COUNT; i++) {
        const bar = document.createElement('div');
        bar.className = 'audio-level__bar';
        const fill = document.createElement('div');
        fill.className = 'audio-level__bar-fill';
        bar.appendChild(fill);
        container.appendChild(bar);
        this.bars.push(bar);
        this.barFills.push(fill);
      }
    },

    connectStream(stream) {
      this.disconnect();
      try {
        this.context = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 64;
        this.source = this.context.createMediaStreamSource(stream);
        this.source.connect(this.analyser);
        this.animate();
      } catch (e) {
        console.error('AudioLevel error:', e);
      }
    },

    animate() {
      if (!this.analyser) return;
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);

      for (let i = 0; i < this.BAR_COUNT; i++) {
        const idx = Math.floor(i * data.length / this.BAR_COUNT);
        const val = data[idx] || 0;
        const pct = Math.min(100, (val / 255) * 100);
        this.barFills[i].style.height = `${Math.max(4, pct)}%`;
      }
      this.animFrame = requestAnimationFrame(() => this.animate());
    },

    disconnect() {
      cancelAnimationFrame(this.animFrame);
      if (this.source) { try { this.source.disconnect(); } catch(e){} }
      if (this.context && this.context.state !== 'closed') {
        try { this.context.close(); } catch(e){}
      }
      this.context = null;
      this.analyser = null;
      this.source = null;
      this.barFills.forEach(f => f.style.height = '0%');
    }
  };

  // =====================
  // Log Manager
  // =====================
  const LogManager = {
    entries: [],
    contentEl: null,
    emptyEl: null,

    init() {
      this.contentEl = document.getElementById('log-content');
      this.emptyEl = document.getElementById('log-empty');
    },

    add(sourceText, translatedText, sourceLang, targetLang) {
      const now = new Date();
      const time = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const entry = { time, sourceText, translatedText, sourceLang, targetLang };
      this.entries.push(entry);

      if (this.emptyEl) this.emptyEl.classList.add('hidden');

      const div = document.createElement('div');
      div.className = 'log-entry';
      const srcBadge = LANGUAGES[sourceLang]?.badge || sourceLang;
      const tgtBadge = LANGUAGES[targetLang]?.badge || targetLang;
      div.innerHTML = `
        <div class="log-entry__time">${time}</div>
        <div class="log-entry__source"><span class="log-entry__lang">${srcBadge}</span>${this.escapeHtml(sourceText)}</div>
        <div class="log-entry__translation"><span class="log-entry__lang">${tgtBadge}</span>${this.escapeHtml(translatedText)}</div>
      `;
      this.contentEl.appendChild(div);
      this.contentEl.scrollTop = this.contentEl.scrollHeight;
    },

    escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    },

    clear() {
      this.entries = [];
      if (this.contentEl) {
        this.contentEl.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'log-empty';
        empty.id = 'log-empty';
        empty.textContent = '翻訳を開始するとログが表示されます';
        this.contentEl.appendChild(empty);
        this.emptyEl = empty;
      }
    },

    toText() {
      return this.entries.map(e =>
        `[${e.time}] [${LANGUAGES[e.sourceLang]?.badge}] ${e.sourceText}\n         [${LANGUAGES[e.targetLang]?.badge}] ${e.translatedText}`
      ).join('\n\n');
    },

    copyToClipboard() {
      const text = this.toText();
      if (!text) { Toast.show('ログが空です', 'info'); return; }
      navigator.clipboard.writeText(text).then(() => {
        Toast.show('ログをコピーしました', 'info');
      }).catch(() => Toast.show('コピーに失敗しました', 'error'));
    },

    download() {
      const text = this.toText();
      if (!text) { Toast.show('ログが空です', 'info'); return; }
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translation_log_${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      Toast.show('ログを保存しました', 'info');
    }
  };

  // =====================
  // Whisper Manager (In-Browser STT)
  // =====================
  const WhisperManager = {
    transcriber: null,
    isLoading: false,
    isReady: false,
    captureContext: null,
    processor: null,
    audioBuffer: [],
    chunkInterval: null,
    CHUNK_SECONDS: 5,
    onTranscript: null,
    currentLang: 'en-US',

    // Whisper language codes
    LANG_MAP: {
      'ja-JP': 'japanese',
      'en-US': 'english',
      'ko-KR': 'korean',
      'fr-FR': 'french'
    },

    async load(onProgress) {
      if (this.isReady || this.isLoading) return;
      this.isLoading = true;

      try {
        const { pipeline } = await import(
          'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
        );

        // Prefer WebGPU, fallback to WASM
        let device = 'wasm';
        let dtype = 'fp32';
        if (navigator.gpu) {
          try {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) { device = 'webgpu'; dtype = 'fp32'; }
          } catch (e) { /* fallback to wasm */ }
        }

        Toast.show(`Whisperモデルを読み込み中 (${device.toUpperCase()})...`, 'info', 10000);

        this.transcriber = await pipeline(
          'automatic-speech-recognition',
          'onnx-community/whisper-tiny',
          { dtype, device, progress_callback: onProgress }
        );

        this.isReady = true;
        Toast.show('✅ Whisperモデル準備完了！', 'info', 3000);
      } catch (err) {
        console.error('Whisper load error:', err);
        Toast.show(`Whisperの読み込みに失敗: ${err.message}`, 'error', 5000);
        throw err;
      } finally {
        this.isLoading = false;
      }
    },

    startCapture(stream, language, onTranscript) {
      this.onTranscript = onTranscript;
      this.currentLang = language;
      this.audioBuffer = [];

      // Create AudioContext at 16kHz for Whisper input
      this.captureContext = new AudioContext({ sampleRate: 16000 });
      const source = this.captureContext.createMediaStreamSource(stream);

      // ScriptProcessor to capture raw PCM at 16kHz
      this.processor = this.captureContext.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (e) => {
        const samples = e.inputBuffer.getChannelData(0);
        this.audioBuffer.push(new Float32Array(samples));
      };
      source.connect(this.processor);
      this.processor.connect(this.captureContext.destination);

      // Process every CHUNK_SECONDS
      this.chunkInterval = setInterval(() => {
        this._processChunk();
      }, this.CHUNK_SECONDS * 1000);
    },

    async _processChunk() {
      if (this.audioBuffer.length === 0 || !this.isReady) return;

      // Merge buffered samples
      const totalLen = this.audioBuffer.reduce((a, b) => a + b.length, 0);
      const merged = new Float32Array(totalLen);
      let off = 0;
      for (const buf of this.audioBuffer) {
        merged.set(buf, off);
        off += buf.length;
      }
      this.audioBuffer = [];

      // Skip silent chunks (RMS < threshold)
      const rms = Math.sqrt(merged.reduce((acc, v) => acc + v * v, 0) / merged.length);
      if (rms < 0.008) return;

      try {
        const result = await this.transcriber(merged, {
          language: this.LANG_MAP[this.currentLang] || 'english',
          task: 'transcribe'
        });

        if (result && result.text && result.text.trim()) {
          // Filter out hallucination patterns
          const text = result.text.trim();
          if (text.length > 2 && !text.match(/^[\.\,\!\?\s]+$/)) {
            this.onTranscript(text);
          }
        }
      } catch (err) {
        console.error('Whisper chunk error:', err);
      }
    },

    setLanguage(lang) {
      this.currentLang = lang;
    },

    stop() {
      if (this.chunkInterval) {
        clearInterval(this.chunkInterval);
        this.chunkInterval = null;
      }
      // Process remaining buffer
      if (this.audioBuffer.length > 0 && this.isReady) {
        this._processChunk();
      }
      if (this.processor) {
        this.processor.disconnect();
        this.processor = null;
      }
      if (this.captureContext) {
        try { this.captureContext.close(); } catch(e) {}
        this.captureContext = null;
      }
      this.audioBuffer = [];
    }
  };

  // =====================
  // Speech Recognition Manager
  // =====================
  const SpeechManager = {
    recognition: null,
    isListening: false,
    inputMode: 'mic', // 'mic' or 'tab'
    engine: 'native', // 'native' or 'whisper'
    tabStream: null,
    micStream: null,
    tabAudioContext: null,

    init() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        document.getElementById('browser-warning')?.classList.remove('hidden');
        document.getElementById('btn-record').disabled = true;
        return false;
      }
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;
      return true;
    },

    async startMic() {
      this.inputMode = 'mic';
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        AudioLevel.connectStream(this.micStream);

        if (this.engine === 'whisper') {
          const srcLang = document.getElementById('source-lang').value;
          WhisperManager.startCapture(this.micStream, srcLang, (text) => {
            App.onWhisperResult(text);
          });
        } else {
          this._startRecognition();
        }
      } catch (err) {
        Toast.show('マイクへのアクセスが拒否されました', 'error');
        throw err;
      }
    },

    async startTabCapture() {
      this.inputMode = 'tab';
      try {
        this.tabStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 1, height: 1 },
          audio: true
        });

        const audioTracks = this.tabStream.getAudioTracks();
        if (audioTracks.length === 0) {
          Toast.show('タブの音声をキャプチャできませんでした。「タブの音声を共有」にチェックを入れてください。', 'error', 5000);
          this.stopTabCapture();
          throw new Error('No audio track');
        }

        // Play tab audio with volume control (gainNode for ducking)
        this.tabAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = this.tabAudioContext.createMediaStreamSource(this.tabStream);
        this.tabGainNode = this.tabAudioContext.createGain();
        this.tabGainNode.gain.value = 0.5; // Start at 50% to not overpower TTS
        source.connect(this.tabGainNode);
        this.tabGainNode.connect(this.tabAudioContext.destination);

        // Update volume slider
        const volSlider = document.getElementById('source-volume');
        if (volSlider) volSlider.value = 0.5;
        const volVal = document.getElementById('source-volume-value');
        if (volVal) volVal.textContent = '50%';

        // Visualize audio level
        AudioLevel.connectStream(this.tabStream);

        // Start recognition (native or Whisper)
        if (this.engine === 'whisper') {
          const srcLang = document.getElementById('source-lang').value;
          WhisperManager.startCapture(this.tabStream, srcLang, (text) => {
            App.onWhisperResult(text);
          });
          Toast.show('タブ音声をWhisperで高精度認識中。VB-Cable不要です！', 'info', 4000);
        } else {
          this._startRecognition();
          Toast.show('タブ音声をキャプチャ中。TTS発話時は元音声が自動で下がります。', 'info', 4000);
        }
      } catch (err) {
        if (err.name === 'NotAllowedError') {
          Toast.show('タブ共有がキャンセルされました', 'info');
        } else if (err.message !== 'No audio track') {
          Toast.show(`タブキャプチャエラー: ${err.message}`, 'error');
        }
        this.stopTabCapture();
        throw err;
      }
    },

    // User-set volume level (the slider value)
    userVolume: 0.5,

    // Set volume directly (used by slider)
    setSourceVolume(vol) {
      this.userVolume = vol;
      if (this.tabGainNode) {
        this.tabGainNode.gain.setTargetAtTime(vol, this.tabAudioContext.currentTime, 0.08);
      }
    },

    // Duck to near-silence (used by TTS auto-ducking)
    duckVolume() {
      if (this.tabGainNode) {
        this.tabGainNode.gain.setTargetAtTime(0.05, this.tabAudioContext.currentTime, 0.08);
      }
    },

    // Restore to user-set volume (after TTS ends)
    restoreUserVolume() {
      if (this.tabGainNode) {
        this.tabGainNode.gain.setTargetAtTime(this.userVolume, this.tabAudioContext.currentTime, 0.15);
      }
    },

    _startRecognition() {
      if (!this.recognition) return;
      const srcLang = document.getElementById('source-lang').value;
      this.recognition.lang = srcLang;
      this.recognition.start();
      this.isListening = true;
    },

    stop() {
      if (this.recognition && this.isListening) {
        this.recognition.stop();
        this.isListening = false;
      }
      WhisperManager.stop();
      this.stopTabCapture();
      if (this.micStream) {
        this.micStream.getTracks().forEach(t => t.stop());
        this.micStream = null;
      }
      AudioLevel.disconnect();
    },

    stopTabCapture() {
      if (this.tabStream) {
        this.tabStream.getTracks().forEach(t => t.stop());
        this.tabStream = null;
      }
      if (this.tabAudioContext) {
        try { this.tabAudioContext.close(); } catch(e){}
        this.tabAudioContext = null;
      }
      this.tabGainNode = null;
    },

    setHandlers(onResult, onEnd, onError) {
      if (!this.recognition) return;

      this.recognition.onresult = (event) => {
        let interim = '';
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += transcript;
          } else {
            interim += transcript;
          }
        }
        onResult(finalText, interim);
      };

      this.recognition.onend = () => {
        // Auto-restart if still supposed to be listening
        if (this.isListening) {
          try { this.recognition.start(); } catch(e) {}
        }
        onEnd();
      };

      this.recognition.onerror = (event) => {
        if (event.error === 'no-speech') return; // ignore silence
        if (event.error === 'aborted') return;
        onError(event.error);
      };
    }
  };

  // =====================
  // App Controller
  // =====================
  const App = {
    isActive: false,
    sourceText: '',
    inputMode: 'mic', // 'mic' or 'tab'
    sttEngine: 'native', // 'native' or 'whisper'

    init() {
      Toast.init();
      TTSManager.init();
      AudioLevel.init();
      LogManager.init();

      const speechSupported = SpeechManager.init();
      if (!speechSupported) return;

      this.bindEvents();
      this.updateBadges();
    },

    bindEvents() {
      // Main record button
      const btnRecord = document.getElementById('btn-record');
      btnRecord.addEventListener('click', () => this.toggleRecording());

      // Input source toggle buttons
      document.getElementById('btn-source-mic').addEventListener('click', () => this.setInputMode('mic'));
      document.getElementById('btn-source-tab').addEventListener('click', () => this.setInputMode('tab'));

      // Language swap
      document.getElementById('btn-swap').addEventListener('click', () => this.swapLanguages());

      // Language selectors
      document.getElementById('source-lang').addEventListener('change', () => this.updateBadges());
      document.getElementById('target-lang').addEventListener('change', () => this.updateBadges());

      // Engine toggle
      document.getElementById('btn-engine-native').addEventListener('click', () => this.setEngine('native'));
      document.getElementById('btn-engine-whisper').addEventListener('click', () => this.setEngine('whisper'));

      // Voice selector
      document.getElementById('voice-select').addEventListener('change', (e) => {
        TTSManager.setVoice(e.target.value);
      });

      // Source volume slider (for tab audio)
      const srcVolSlider = document.getElementById('source-volume');
      const srcVolValue = document.getElementById('source-volume-value');
      srcVolSlider.addEventListener('input', () => {
        const val = parseFloat(srcVolSlider.value);
        srcVolValue.textContent = `${Math.round(val * 100)}%`;
        SpeechManager.setSourceVolume(val);
      });

      // Speed slider
      const speedSlider = document.getElementById('speed-slider');
      const speedValue = document.getElementById('speed-value');
      speedSlider.addEventListener('input', () => {
        const val = parseFloat(speedSlider.value);
        speedValue.textContent = `${val.toFixed(1)}x`;
        TTSManager.setSpeed(val);
      });

      // Pitch slider
      const pitchSlider = document.getElementById('pitch-slider');
      const pitchValue = document.getElementById('pitch-value');
      pitchSlider.addEventListener('input', () => {
        const val = parseFloat(pitchSlider.value);
        pitchValue.textContent = val.toFixed(1);
        TTSManager.setPitch(val);
      });

      // Auto TTS toggle
      document.getElementById('auto-tts-toggle').addEventListener('click', (e) => {
        const on = TTSManager.toggleAuto();
        e.target.textContent = on ? 'ON' : 'OFF';
        e.target.dataset.active = on;
        e.target.style.color = on ? 'var(--accent-green)' : 'var(--text-muted)';
      });

      // Log actions
      document.getElementById('btn-copy-log').addEventListener('click', () => LogManager.copyToClipboard());
      document.getElementById('btn-download-log').addEventListener('click', () => LogManager.download());
      document.getElementById('btn-clear-log').addEventListener('click', () => {
        LogManager.clear();
        Toast.show('ログをクリアしました', 'info');
      });

      // Settings modal
      document.getElementById('btn-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('modal-overlay--visible');
      });
      document.getElementById('btn-close-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('modal-overlay--visible');
      });
      document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
          e.target.classList.remove('modal-overlay--visible');
        }
      });

      // Speech recognition handlers
      SpeechManager.setHandlers(
        (finalText, interim) => this.onSpeechResult(finalText, interim),
        () => this.onSpeechEnd(),
        (error) => this.onSpeechError(error)
      );

      // Keyboard shortcut: Space to toggle
      document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          this.toggleRecording();
        }
      });
    },

    setInputMode(mode) {
      this.inputMode = mode;
      document.querySelectorAll('.source-btn').forEach(btn => {
        btn.classList.toggle('source-btn--active', btn.dataset.mode === mode);
      });
      // If already recording, restart with new mode
      if (this.isActive) {
        this.stopRecording();
        setTimeout(() => this.startRecording(mode), 300);
      }
    },

    toggleRecording() {
      if (this.isActive) {
        this.stopRecording();
      } else {
        this.startRecording(this.inputMode);
      }
    },

    async startRecording(mode = 'mic') {
      try {
        // If Whisper engine selected, ensure model is loaded first
        if (this.sttEngine === 'whisper' && !WhisperManager.isReady) {
          await this.loadWhisperModel();
        }

        if (mode === 'tab') {
          await SpeechManager.startTabCapture();
        } else {
          await SpeechManager.startMic();
        }
        this.isActive = true;
        this.inputMode = mode;
        this.updateRecordingUI(true);

        const modeLabel = mode === 'tab' ? 'タブ音声' : 'マイク';
        const engineLabel = this.sttEngine === 'whisper' ? ' (Whisper高精度)' : '';
        Toast.show(`${modeLabel}${engineLabel}で翻訳を開始しました`, 'info');
      } catch (err) {
        this.isActive = false;
        this.updateRecordingUI(false);
      }
    },

    stopRecording() {
      SpeechManager.stop();
      TTSManager.stop();
      this.isActive = false;
      this.sourceText = '';
      this.updateRecordingUI(false);
      Toast.show('翻訳を停止しました', 'info');
    },

    // Engine toggle
    setEngine(engine) {
      this.sttEngine = engine;
      SpeechManager.engine = engine;

      // Update UI
      document.querySelectorAll('#engine-toggle .source-btn').forEach(btn => {
        btn.classList.toggle('source-btn--active', btn.dataset.engine === engine);
      });

      // If switching to Whisper, preload model
      if (engine === 'whisper' && !WhisperManager.isReady && !WhisperManager.isLoading) {
        this.loadWhisperModel();
      }

      // Restart if currently recording
      if (this.isActive) {
        this.stopRecording();
        setTimeout(() => this.startRecording(this.inputMode), 300);
      }
    },

    async loadWhisperModel() {
      const progressEl = document.getElementById('whisper-progress');
      const labelEl = document.getElementById('whisper-progress-label');
      const fillEl = document.getElementById('whisper-progress-fill');

      progressEl.classList.remove('hidden');
      labelEl.textContent = 'Whisperモデルをダウンロード中...';
      fillEl.style.width = '0%';

      try {
        await WhisperManager.load((progress) => {
          if (progress.status === 'progress' && progress.total) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            fillEl.style.width = `${pct}%`;
            const mb = (progress.loaded / 1024 / 1024).toFixed(1);
            const totalMb = (progress.total / 1024 / 1024).toFixed(1);
            labelEl.textContent = `モデルダウンロード中... ${mb}MB / ${totalMb}MB`;
          } else if (progress.status === 'ready') {
            fillEl.style.width = '100%';
            labelEl.textContent = '✅ Whisper準備完了！';
          }
        });
        setTimeout(() => progressEl.classList.add('hidden'), 2000);
      } catch (err) {
        labelEl.textContent = '❌ 読み込みに失敗しました';
        setTimeout(() => progressEl.classList.add('hidden'), 3000);
        // Revert to native engine
        this.setEngine('native');
      }
    },

    // Whisper result handler (called from WhisperManager via SpeechManager)
    onWhisperResult(text) {
      if (!this.isActive) return;

      const sourceContentEl = document.getElementById('source-content');
      sourceContentEl.classList.remove('panel__content--empty');

      // Append to source text display
      this.sourceText += text + ' ';
      sourceContentEl.innerHTML = `<span class="text-final">${this.escapeHtml(this.sourceText)}</span>`;
      sourceContentEl.scrollTop = sourceContentEl.scrollHeight;

      // Translate (direct, no debounce needed since Whisper already batches)
      this._flushWhisperTranslation(text);
    },

    async _flushWhisperTranslation(text) {
      const srcSelect = document.getElementById('source-lang');
      const tgtSelect = document.getElementById('target-lang');
      const srcLangCode = srcSelect.options[srcSelect.selectedIndex].dataset.translate;
      const tgtLangCode = tgtSelect.options[tgtSelect.selectedIndex].dataset.translate;
      const tgtSpeechLang = tgtSelect.value;
      const translationContentEl = document.getElementById('translation-content');

      const translated = await TranslationManager.translate(text, srcLangCode, tgtLangCode);

      // Show translation
      translationContentEl.classList.remove('panel__content--empty');
      const span = document.createElement('span');
      span.className = 'text-translated';
      span.textContent = translated + ' ';

      if (translationContentEl.textContent === '翻訳結果がここに表示されます') {
        translationContentEl.innerHTML = '';
      }
      translationContentEl.appendChild(span);
      translationContentEl.scrollTop = translationContentEl.scrollHeight;

      // TTS
      TTSManager.enqueue(translated, tgtSpeechLang);

      // Log
      LogManager.add(text, translated, srcSelect.value, tgtSelect.value);

      // Activate translation panel
      document.getElementById('translation-panel').classList.add('panel--active');
      setTimeout(() => {
        document.getElementById('translation-panel').classList.remove('panel--active');
      }, 2000);
    },

    // Translation request counter to skip stale results
    _translationId: 0,
    _pendingTranslations: 0,
    _batchBuffer: '',
    _batchTimer: null,

    async onSpeechResult(finalText, interim) {
      const sourceContentEl = document.getElementById('source-content');
      const translationContentEl = document.getElementById('translation-content');

      // Show source text
      sourceContentEl.classList.remove('panel__content--empty');
      let html = '';
      if (this.sourceText) {
        html += `<span class="text-final">${this.escapeHtml(this.sourceText)}</span> `;
      }
      if (finalText) {
        html += `<span class="text-final">${this.escapeHtml(finalText)}</span> `;
      }
      if (interim) {
        html += `<span class="text-interim">${this.escapeHtml(interim)}</span>`;
      }
      sourceContentEl.innerHTML = html;
      sourceContentEl.scrollTop = sourceContentEl.scrollHeight;

      // Batch final texts and translate with debounce
      if (finalText.trim()) {
        this.sourceText += finalText + ' ';
        this._batchBuffer += finalText.trim() + ' ';

        // Debounce: wait 400ms for more text before translating
        // This batches rapid-fire recognition results
        clearTimeout(this._batchTimer);
        this._batchTimer = setTimeout(() => this._flushTranslation(), 400);
      }
    },

    async _flushTranslation() {
      const textToTranslate = this._batchBuffer.trim();
      this._batchBuffer = '';
      if (!textToTranslate) return;

      const myId = ++this._translationId;
      this._pendingTranslations++;

      const srcSelect = document.getElementById('source-lang');
      const tgtSelect = document.getElementById('target-lang');
      const srcLangCode = srcSelect.options[srcSelect.selectedIndex].dataset.translate;
      const tgtLangCode = tgtSelect.options[tgtSelect.selectedIndex].dataset.translate;
      const tgtSpeechLang = tgtSelect.value;
      const translationContentEl = document.getElementById('translation-content');

      const translated = await TranslationManager.translate(textToTranslate, srcLangCode, tgtLangCode);
      this._pendingTranslations--;

      // Skip if a newer translation has already completed
      if (myId < this._translationId - 2) {
        console.warn('Skipping stale translation:', textToTranslate.substring(0, 30));
        return;
      }

      // Show translation
      translationContentEl.classList.remove('panel__content--empty');
      const span = document.createElement('span');
      span.className = 'text-translated';
      span.textContent = translated + ' ';

      if (translationContentEl.textContent === '翻訳結果がここに表示されます') {
        translationContentEl.innerHTML = '';
      }
      translationContentEl.appendChild(span);
      translationContentEl.scrollTop = translationContentEl.scrollHeight;

      // TTS
      TTSManager.enqueue(translated, tgtSpeechLang);

      // Log
      LogManager.add(textToTranslate, translated, srcSelect.value, tgtSelect.value);

      // Activate translation panel
      document.getElementById('translation-panel').classList.add('panel--active');
      setTimeout(() => {
        document.getElementById('translation-panel').classList.remove('panel--active');
      }, 2000);
    },

    onSpeechEnd() {
      // Auto-restart handled in SpeechManager
    },

    onSpeechError(error) {
      console.error('Speech error:', error);
      if (error === 'not-allowed') {
        Toast.show('マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。', 'error', 5000);
        this.stopRecording();
      } else if (error === 'network') {
        Toast.show('ネットワークエラー。インターネット接続を確認してください。', 'error');
      }
    },

    updateRecordingUI(active) {
      const btn = document.getElementById('btn-record');
      const label = document.getElementById('btn-record-label');
      const sourcePanel = document.getElementById('source-panel');

      if (active) {
        btn.classList.add('btn-main--active');
        btn.querySelector('.btn-main__icon').textContent = '⏹';
        const modeLabel = this.inputMode === 'tab' ? '停止 (タブ)' : '停止';
        label.textContent = modeLabel;
        sourcePanel.classList.add('panel--active');
      } else {
        btn.classList.remove('btn-main--active');
        btn.querySelector('.btn-main__icon').textContent = '🎤';
        label.textContent = '翻訳開始';
        sourcePanel.classList.remove('panel--active');
      }
    },

    swapLanguages() {
      const srcSelect = document.getElementById('source-lang');
      const tgtSelect = document.getElementById('target-lang');
      const srcVal = srcSelect.value;
      const tgtVal = tgtSelect.value;
      srcSelect.value = tgtVal;
      tgtSelect.value = srcVal;
      this.updateBadges();

      // If currently recording, restart with new language
      if (this.isActive) {
        SpeechManager.stop();
        this.sourceText = '';
        document.getElementById('source-content').innerHTML = '';
        document.getElementById('source-content').classList.add('panel__content--empty');
        document.getElementById('source-content').textContent = 'マイクボタンを押して話し始めてください';
        document.getElementById('translation-content').innerHTML = '';
        document.getElementById('translation-content').classList.add('panel__content--empty');
        document.getElementById('translation-content').textContent = '翻訳結果がここに表示されます';
        setTimeout(() => SpeechManager.startMic(), 300);
      }

      Toast.show('言語を入れ替えました', 'info');
    },

    updateBadges() {
      const srcSelect = document.getElementById('source-lang');
      const tgtSelect = document.getElementById('target-lang');
      const srcLang = LANGUAGES[srcSelect.value];
      const tgtLang = LANGUAGES[tgtSelect.value];
      document.getElementById('source-lang-badge').textContent = srcLang?.badge || '';
      document.getElementById('target-lang-badge').textContent = tgtLang?.badge || '';
    },

    escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  };

  // --- Boot ---
  document.addEventListener('DOMContentLoaded', () => App.init());
})();
