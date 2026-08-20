const OpenAI = require('openai');
const Replicate = require('replicate');
const fs = require('fs').promises;
const path = require('path');
const { pathToFileURL } = require('url');
const axios = require('axios');
const { Logger } = require('./logger');
const { runFFmpeg, checkFFmpeg, ffmpegInstallHint } = require('./ffmpeg');
const { Biology3DRenderer } = require('./biology-3d-renderer');

class AIVideoGenerator {
  constructor(credentials) {
    this.logger = new Logger('AIVideoGenerator');
    
    // Initialize AI services with graceful fallback
    const openaiKey = credentials.openai?.apiKey || process.env.OPENAI_API_KEY;
    const replicateKey = credentials.replicate?.apiKey || process.env.REPLICATE_API_KEY;
    
    if (openaiKey) {
      this.openai = new OpenAI({ apiKey: openaiKey });
      this.logger.info('OpenAI service initialized');
    } else {
      this.logger.warn('OpenAI API key not found - AI features will be simulated');
    }
    
    if (replicateKey) {
      this.replicate = new Replicate({ auth: replicateKey });
      this.logger.info('Replicate service initialized');
    } else {
      this.logger.warn('Replicate API key not found - advanced video generation unavailable');
    }

    // Gemini media generation (images + native TTS). Availability depends on the
    // selected Gemini model and the project's billing tier.
    const geminiKey = credentials.gemini?.apiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const { GoogleGenAI } = require('@google/genai');
        this.gemini = new GoogleGenAI({ apiKey: geminiKey });
        this.logger.info('Gemini media service initialized (images + TTS)');
      } catch (error) {
        this.logger.warn('Failed to initialize Gemini media service:', error.message);
      }
    }
    
    // ElevenLabs configuration
    this.elevenLabsApiKey = credentials.elevenLabs?.apiKey || process.env.ELEVENLABS_API_KEY;
    this.elevenLabsVoiceId = credentials.elevenLabs?.voiceId || process.env.ELEVENLABS_VOICE_ID;
    
    // Azure Speech configuration
    this.azureSpeechKey = credentials.azure?.speechKey || process.env.AZURE_SPEECH_KEY;
    this.azureSpeechRegion = credentials.azure?.speechRegion || process.env.AZURE_SPEECH_REGION;
  }

  async generateTTSAudio(text, outputPath) {
    this.logger.info('Generating TTS audio...');
    
    try {
      // Try ElevenLabs first (higher quality)
      if (this.elevenLabsApiKey && this.elevenLabsVoiceId) {
        return await this.generateElevenLabsTTS(text, outputPath);
      }
      
      // Fallback to OpenAI TTS
      if (this.openai) {
        return await this.generateOpenAITTS(text, outputPath);
      }

      // Fallback to Gemini native TTS (free tier)
      if (this.gemini) {
        return await this.generateGeminiTTS(text, outputPath);
      }

      // Final fallback to simulation
      return await this.simulateTTSGeneration(text, outputPath);
    } catch (error) {
      this.logger.error('TTS generation failed:', error);
      throw error;
    }
  }

  async generateElevenLabsTTS(text, outputPath) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.elevenLabsVoiceId}`;
    
    const data = {
      text: text,
      model_id: "eleven_v3",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.0,
        use_speaker_boost: true
      }
    };

    const response = await axios({
      method: 'POST',
      url: url,
      data: data,
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.elevenLabsApiKey
      },
      responseType: 'stream'
    });

    const writer = require('fs').createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        this.logger.info('ElevenLabs TTS generation complete');
        resolve(outputPath);
      });
      writer.on('error', reject);
    });
  }

  async generateOpenAITTS(text, outputPath) {
    const response = await this.openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: text,
      speed: 1.0
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputPath, buffer);

    this.logger.info('OpenAI TTS generation complete');
    return outputPath;
  }

  async generateGeminiTTS(text, outputPath) {
    const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
    const voiceName = process.env.GEMINI_TTS_VOICE || 'Kore';
    const biologyMode = String(process.env.BLAIZE_BIOLOGY_MODE || '').toLowerCase() === 'true';
    const directions = biologyMode
      ? 'Read this Biology lesson in a clear, warm, neutral African-British academic voice. Use calm authority, natural pacing, precise scientific pronunciation and brief pauses around definitions. Do not speak these directions.'
      : 'Read the following narration naturally. Do not speak these directions.';
    const chunks = this.splitTextForTTS(text);

    if (chunks.length === 0) {
      throw new Error('Gemini TTS received no narration text');
    }

    this.logger.info(`Generating Gemini TTS in ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}...`);
    const audioBuffers = [];
    for (let index = 0; index < chunks.length; index++) {
      this.logger.info(`Gemini TTS chunk ${index + 1}/${chunks.length}`);
      audioBuffers.push(await this.generateGeminiTTSChunk({
        text: `${directions}\n\nLesson part ${index + 1} of ${chunks.length}:\n${chunks[index]}`,
        model,
        voiceName,
        chunkNumber: index + 1,
        totalChunks: chunks.length
      }));
    }

    // Gemini returns raw PCM (24kHz, mono, 16-bit). Chunks use the same
    // format and voice, so they can be concatenated before one final encode.
    const pcmPath = outputPath + '.pcm';
    try {
      await fs.writeFile(pcmPath, Buffer.concat(audioBuffers));
      await runFFmpeg(['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcmPath, outputPath]);
    } finally {
      await fs.unlink(pcmPath).catch(() => {});
    }

    this.logger.info('Gemini TTS generation complete');
    return outputPath;
  }

  splitTextForTTS(text, maxCharacters = 2400) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const sentences = normalized
      .split(/(?<=[.!?])\s+|\n{2,}/)
      .map(part => part.trim())
      .filter(Boolean);
    const chunks = [];
    let current = '';

    const appendPiece = piece => {
      if (!current) {
        current = piece;
      } else if (current.length + 1 + piece.length <= maxCharacters) {
        current += ` ${piece}`;
      } else {
        chunks.push(current);
        current = piece;
      }
    };

    for (const sentence of sentences) {
      if (sentence.length <= maxCharacters) {
        appendPiece(sentence);
        continue;
      }

      const words = sentence.split(/\s+/);
      let piece = '';
      for (const word of words) {
        if (!piece) {
          piece = word;
        } else if (piece.length + 1 + word.length <= maxCharacters) {
          piece += ` ${word}`;
        } else {
          appendPiece(piece);
          piece = word;
        }
      }
      if (piece) appendPiece(piece);
    }

    if (current) chunks.push(current);
    return chunks;
  }

  async generateGeminiTTSChunk({ text, model, voiceName, chunkNumber, totalChunks, retries = 3 }) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.gemini.models.generateContent({
          model,
          contents: [{ parts: [{ text }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName }
              }
            }
          }
        });

        const audioPart = response.candidates?.[0]?.content?.parts
          ?.find(part => part.inlineData?.data);
        if (!audioPart?.inlineData?.data) {
          throw new Error('Gemini TTS returned no audio data');
        }
        return Buffer.from(audioPart.inlineData.data, 'base64');
      } catch (error) {
        const retryable = this.isRetryableGeminiMediaError(error);
        if (!retryable || attempt === retries) throw error;

        const delayMs = Math.min(15000, 2000 * (2 ** attempt));
        this.logger.warn(
          `Gemini TTS chunk ${chunkNumber}/${totalChunks} failed (${error.message}); retrying ${attempt + 1}/${retries} in ${delayMs / 1000}s`
        );
        await this.sleep(delayMs);
      }
    }

    throw new Error('Gemini TTS retry loop ended unexpectedly');
  }

  isRetryableGeminiMediaError(error) {
    const status = Number(error?.status || error?.response?.status || error?.code);
    if ([408, 429, 500, 502, 503, 504].includes(status)) return true;

    return /timeout|timed out|high demand|temporar|unavailable|resource exhausted|rate limit|network|fetch failed|socket hang up|ECONNRESET|ETIMEDOUT/i
      .test(String(error?.message || ''));
  }

  async sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async generateVisualAssets(prompt, style = "ethereal", count = 1) {
    this.logger.info(`Generating ${count} visual assets with style: ${style}`);

    try {
      if (!this.openai && !this.gemini) {
        return await this.simulateVisualAssets(prompt, style, count);
      }

      const enhancedPrompt = this.enhanceVisualPrompt(prompt, style);
      const localPaths = [];

      for (let i = 0; i < count; i++) {
        const imagePath = path.join(__dirname, '..', 'data', 'assets', `visual_${Date.now()}_${i}.png`);
        await this.generateImage(enhancedPrompt, imagePath);
        localPaths.push(imagePath);
      }

      this.logger.info(`Generated ${localPaths.length} visual assets`);
      return localPaths;
    } catch (error) {
      this.logger.error('Visual asset generation failed:', error);
      return await this.simulateVisualAssets(prompt, style, count);
    }
  }

  async generateImage(prompt, imagePath) {
    await fs.mkdir(path.dirname(imagePath), { recursive: true });

    if (this.openai) {
      return await this.generateOpenAIImage(prompt, imagePath);
    }

    if (this.gemini) {
      return await this.generateGeminiImage(prompt, imagePath);
    }

    throw new Error('No image generation provider configured');
  }

  async generateOpenAIImage(prompt, imagePath) {
    const response = await this.openai.images.generate({
      model: "gpt-image-2",
      prompt: prompt,
      n: 1,
      size: "1536x1024",
      quality: "high",
    });

    if (response.data[0].b64_json) {
      const buffer = Buffer.from(response.data[0].b64_json, 'base64');
      await fs.writeFile(imagePath, buffer);
    } else {
      await this.downloadImage(response.data[0].url, imagePath);
    }

    return imagePath;
  }

  async generateGeminiImage(prompt, imagePath) {
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

    const response = await this.gemini.models.generateContent({
      model,
      contents: prompt
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(part => part.inlineData?.data);
    if (!imagePart) {
      throw new Error('Gemini image generation returned no image data');
    }

    await fs.writeFile(imagePath, Buffer.from(imagePart.inlineData.data, 'base64'));
    return imagePath;
  }

  enhanceVisualPrompt(prompt, style) {
    const styleEnhancements = {
      ethereal: "ethereal, dreamy, mystical, soft lighting, floating particles, cosmic background",
      modern: "modern, clean, minimalist, professional, sleek design, contemporary",
      animated: "animated style, cartoon, vibrant colors, expressive, dynamic",
      cinematic: "cinematic lighting, dramatic, movie poster style, high contrast",
      abstract: "abstract art, geometric shapes, gradient colors, artistic composition"
    };

    const enhancement = styleEnhancements[style] || styleEnhancements.ethereal;
    return `${prompt}, ${enhancement}, high quality, 16:9 aspect ratio, digital art`;
  }

  async downloadImage(url, outputPath) {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const writer = require('fs').createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  async generateVideo(script, visualAssets, audioPath, outputPath) {
    this.logger.info('Generating video from assets...');
    
    try {
      const biologyMode = String(process.env.BLAIZE_BIOLOGY_MODE || '').toLowerCase() === 'true';
      const use3D = String(process.env.BIOLOGY_3D_VISUALS || 'true').toLowerCase() !== 'false';
      if (biologyMode) {
        if (!use3D) throw new Error('Blaize Biology production requires BIOLOGY_3D_VISUALS=true');
        return await this.generateBiology3DVideo(script, audioPath, outputPath);
      }

      // Try Replicate for video generation first
      if (this.replicate && this.replicate.auth) {
        return await this.generateReplicateVideo(script, visualAssets, audioPath, outputPath);
      }
      
      // Fallback to simple slideshow with Playwright
      return await this.generateSlideshowVideo(script, visualAssets, audioPath, outputPath);
    } catch (error) {
      this.logger.error('Video generation failed:', error);
      return await this.simulateVideoGeneration(script, visualAssets, audioPath, outputPath);
    }
  }

  async generateBiology3DVideo(script, audioPath, outputPath) {
    if (!(await checkFFmpeg())) throw new Error(ffmpegInstallHint());
    if (!(await this.isUsableAudioFile(audioPath))) throw new Error('Narration is required before 3D rendering');

    const sections = script.mainContent?.sections || [];
    if (sections.length === 0 || sections.some(section => !section.visualSpec?.template)) {
      throw new Error('The script is missing topic-specific 3D visual specifications');
    }

    const workDir = outputPath.replace(/\.mp4$/i, '_3d_work');
    const clipsDir = path.join(workDir, 'clips');
    const segmentsDir = path.join(workDir, 'segments');
    const visualPath = outputPath.replace(/\.mp4$/i, '_3d_visual.mp4');
    await fs.mkdir(segmentsDir, { recursive: true });

    try {
      const renderer = new Biology3DRenderer();
      const clips = await renderer.renderSectionClips(sections, clipsDir, 5);
      const segments = [];

      for (let index = 0; index < clips.length; index++) {
        const segmentPath = path.join(segmentsDir, `segment_${String(index).padStart(2, '0')}.mp4`);
        await runFFmpeg([
          '-y', '-stream_loop', '-1', '-i', clips[index].path,
          '-t', String(clips[index].duration),
          '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv420p',
          '-r', '30', '-an', '-c:v', 'libx264', '-preset', 'veryfast', segmentPath
        ]);
        segments.push(segmentPath);
      }

      const concatPath = path.join(workDir, 'segments.txt');
      const concatList = segments
        .map(segment => `file '${segment.replace(/'/g, "'\\''")}'`)
        .join('\n');
      await fs.writeFile(concatPath, concatList);
      await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', visualPath]);
      await this.addAudioToVideo(visualPath, audioPath, outputPath);
      this.logger.info('Topic-specific 3D Biology video assembly complete');
      return outputPath;
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      await fs.unlink(visualPath).catch(() => {});
    }
  }

  async generateReplicateVideo(script, visualAssets, audioPath, outputPath) {
    const output = await this.replicate.run(
      "wan-video/wan-2.7-i2v",
      {
        input: {
          image: visualAssets[0],
          prompt: script.title || "smooth cinematic motion",
          duration: 5,
          resolution: "720p"
        }
      }
    );

    // Download the generated video
    if (output && output.length > 0) {
      await this.downloadVideo(output[0], outputPath);
      
      // Add audio track
      await this.addAudioToVideo(outputPath, audioPath, outputPath);
    }

    return outputPath;
  }

  async generateSlideshowVideo(script, visualAssets, audioPath, outputPath) {
    this.logger.info('Creating slideshow video...');

    if (!(await checkFFmpeg())) {
      throw new Error(ffmpegInstallHint());
    }

    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const slidesDir = path.join(path.dirname(outputPath), 'slides');

    try {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1920, height: 1080 });

      // Create HTML for slideshow (only real image files can be embedded)
      const imageAssets = await this.filterImageAssets(visualAssets);
      await page.setContent(this.createSlideshowHTML(script, imageAssets));

      // Freeze CSS transitions/animations so each still is captured fully rendered
      await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
      await page.waitForTimeout(1000); // Wait for assets to load

      // Capture ONE still per slide instead of screenshotting at 30fps —
      // FFmpeg turns the stills into a crossfaded video in seconds.
      const slideCount = await page.evaluate(() => document.querySelectorAll('.slide').length);
      await fs.mkdir(slidesDir, { recursive: true });

      const stills = [];
      for (let i = 0; i < slideCount; i++) {
        await page.evaluate((index) => {
          document.querySelectorAll('.slide').forEach((slide, s) => {
            slide.classList.toggle('active', s === index);
          });
        }, i);

        const stillPath = path.join(slidesDir, `slide_${String(i).padStart(3, '0')}.png`);
        await page.screenshot({ path: stillPath });
        stills.push(stillPath);
      }

      const videoPath = outputPath.replace('.mp4', '_visual.mp4');
      const duration = this.calculateScriptDuration(script);
      await this.renderSlidesToVideo(stills, duration, videoPath);

      // Add audio
      await this.addAudioToVideo(videoPath, audioPath, outputPath);

      return outputPath;
    } finally {
      await browser.close().catch(() => {});
      await this.cleanupDirectory(slidesDir);
    }
  }

  async renderSlidesToVideo(stills, totalDuration, videoPath) {
    if (stills.length === 0) {
      throw new Error('No slides to render');
    }

    const fade = 0.5;
    const perSlide = Math.max(2, totalDuration / stills.length);

    const args = ['-y'];
    for (const still of stills) {
      args.push('-loop', '1', '-t', perSlide.toFixed(2), '-framerate', '30', '-i', still);
    }

    if (stills.length === 1) {
      args.push('-vf', 'format=yuv420p', '-c:v', 'libx264', videoPath);
      await runFFmpeg(args);
      return videoPath;
    }

    // Chain crossfades: transition k starts fade seconds before slide k ends
    const filters = [];
    let prev = '[0:v]';
    for (let i = 1; i < stills.length; i++) {
      const out = `[v${i}]`;
      const offset = (i * (perSlide - fade)).toFixed(2);
      filters.push(`${prev}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset}${out}`);
      prev = out;
    }
    filters.push(`${prev}format=yuv420p[vfinal]`);

    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[vfinal]',
      '-c:v', 'libx264',
      '-r', '30',
      videoPath
    );

    await runFFmpeg(args);
    return videoPath;
  }

  async filterImageAssets(visualAssets = []) {
    const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
    const images = [];

    for (const asset of visualAssets) {
      if (typeof asset !== 'string' || !imageExtensions.has(path.extname(asset).toLowerCase())) {
        continue;
      }

      try {
        await fs.access(asset);
        images.push(pathToFileURL(asset).href);
      } catch (error) {
        // Skip missing files
      }
    }

    return images;
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  createSlideshowHTML(script, visualAssets) {
    const biologyMode = String(process.env.BLAIZE_BIOLOGY_MODE || '').toLowerCase() === 'true';
    const brandLabel = biologyMode ? 'Blaize Tutors · The Biology Series' : 'YouTube Automation';
    const closingTitle = biologyMode ? 'Biology, explained.' : 'Subscribe for More';
    const closingText = biologyMode
      ? 'From first principles to exam marks.'
      : 'New lessons coming soon';

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        :root {
            --deep-green: ${biologyMode ? '#062C2A' : '#667eea'};
            --deep-green-2: ${biologyMode ? '#021A19' : '#764ba2'};
            --turquoise: ${biologyMode ? '#35D6CF' : '#FFFFFF'};
            --flame-orange: ${biologyMode ? '#F36B21' : '#FFFFFF'};
            --flame-yellow: ${biologyMode ? '#FFD54A' : '#FFFFFF'};
            --paper: ${biologyMode ? '#F4E8CC' : '#FFFFFF'};
        }

        body {
            margin: 0;
            padding: 0;
            width: 1920px;
            height: 1080px;
            background:
                radial-gradient(circle at 82% 18%, rgba(53,214,207,0.16), transparent 26%),
                linear-gradient(135deg, var(--deep-green) 0%, var(--deep-green-2) 100%);
            font-family: Georgia, 'Times New Roman', serif;
            overflow: hidden;
        }

        body::before {
            content: '';
            position: absolute;
            inset: 34px;
            border: 2px solid rgba(244,232,204,0.34);
            box-shadow: inset 0 0 0 1px rgba(53,214,207,0.18);
            pointer-events: none;
            z-index: 4;
        }
        
        .slide {
            position: absolute;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 2s ease-in-out;
        }
        
        .slide.active {
            opacity: 1;
        }
        
        .content {
            text-align: center;
            color: var(--paper);
            max-width: 80%;
            padding: 72px 96px;
            background: rgba(2,26,25,0.48);
            border-top: 3px solid var(--turquoise);
            border-bottom: 1px solid rgba(244,232,204,0.4);
            box-shadow: 0 24px 70px rgba(0,0,0,0.28);
        }
        
        h1 {
            font-size: 72px;
            margin-bottom: 30px;
            text-shadow: 0 4px 18px rgba(0,0,0,0.55);
            letter-spacing: 0.01em;
        }
        
        h2 {
            font-size: 48px;
            margin-bottom: 20px;
            color: var(--flame-yellow);
            text-shadow: 0 4px 18px rgba(0,0,0,0.55);
        }
        
        p {
            font-size: 36px;
            line-height: 1.4;
            font-family: Arial, sans-serif;
            text-shadow: 0 2px 8px rgba(0,0,0,0.55);
        }

        .series-label {
            margin-bottom: 26px;
            color: var(--turquoise);
            font: 700 25px/1.2 Arial, sans-serif;
            letter-spacing: 0.18em;
            text-transform: uppercase;
        }

        .accent-rule {
            width: 180px;
            height: 7px;
            margin: 30px auto;
            background: linear-gradient(90deg, var(--flame-orange), var(--flame-yellow));
        }
        
        .background-image {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0.3;
            z-index: -1;
        }
        
        .particles {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            z-index: -1;
        }
        
        .particle {
            position: absolute;
            background: rgba(53,214,207,0.72);
            border-radius: 50%;
            animation: float 6s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-20px); }
        }
    </style>
</head>
<body>
    <div class="particles"></div>
    
    <!-- Title Slide -->
    <div class="slide active">
        ${visualAssets[0] ? `<img class="background-image" src="${visualAssets[0]}" />` : ''}
        <div class="content">
            <div class="series-label">${this.escapeHtml(brandLabel)}</div>
            <h1>${this.escapeHtml(script.title)}</h1>
            <div class="accent-rule"></div>
            <p>Biology, explained. From first principles to exam marks.</p>
        </div>
    </div>
    
    ${this.generateContentSlides(script, visualAssets).join('')}
    
    <!-- Subscribe Slide -->
    <div class="slide">
        <div class="content">
            <div class="series-label">Blaize Tutors</div>
            <h2>${this.escapeHtml(closingTitle)}</h2>
            <div class="accent-rule"></div>
            <p>${this.escapeHtml(closingText)}</p>
        </div>
    </div>
    
    <script>
        // Create floating particles
        function createParticles() {
            const container = document.querySelector('.particles');
            for (let i = 0; i < 20; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.top = Math.random() * 100 + '%';
                particle.style.width = (Math.random() * 4 + 2) + 'px';
                particle.style.height = particle.style.width;
                particle.style.animationDelay = Math.random() * 6 + 's';
                container.appendChild(particle);
            }
        }
        
        let currentSlide = 0;
        const slides = document.querySelectorAll('.slide');
        
        function advanceAnimation() {
            slides[currentSlide].classList.remove('active');
            currentSlide = (currentSlide + 1) % slides.length;
            slides[currentSlide].classList.add('active');
        }
        
        window.advanceAnimation = advanceAnimation;
        createParticles();
    </script>
</body>
</html>`;
  }

  generateContentSlides(script, visualAssets) {
    const slides = [];
    
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach((section, index) => {
        const assetIndex = Math.min(index + 1, visualAssets.length - 1);
        
        slides.push(`
        <div class="slide">
            ${visualAssets[assetIndex] ? `<img class="background-image" src="${visualAssets[assetIndex]}" />` : ''}
            <div class="content">
                <h2>${this.escapeHtml(section.title)}</h2>
                ${this.formatSectionContent(section)}
            </div>
        </div>`);
      });
    }
    
    return slides;
  }

  formatSectionContent(section) {
    if (section.items && Array.isArray(section.items)) {
      return section.items.slice(0, 3).map(item => 
        `<p>${this.escapeHtml(item.number)}. ${this.escapeHtml(item.title)}</p>`
      ).join('');
    }
    
    if (section.steps && Array.isArray(section.steps)) {
      return section.steps.slice(0, 3).map(step => 
        `<p>${this.escapeHtml(step.title)}</p>`
      ).join('');
    }

    if (Array.isArray(section.content)) {
      return section.content
        .filter(item => typeof item === 'string' && item.trim())
        .slice(0, 3)
        .map(item => `<p>${this.escapeHtml(item.slice(0, 220))}${item.length > 220 ? '…' : ''}</p>`)
        .join('');
    }
    
    if (typeof section.content === 'string') {
      return `<p>${this.escapeHtml(section.content.slice(0, 200))}${section.content.length > 200 ? '…' : ''}</p>`;
    }
    
    return '<p>Content coming soon...</p>';
  }

  calculateScriptDuration(script) {
    // Estimate duration based on word count (average 150 words per minute)
    let totalWords = 0;
    
    if (script.hook) totalWords += script.hook.text.split(' ').length;
    if (script.introduction) {
      totalWords += (script.introduction.greeting || '').split(' ').length;
      totalWords += (script.introduction.topicIntro || '').split(' ').length;
    }
    
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach(section => {
        if (typeof section.content === 'string') {
          totalWords += section.content.split(' ').length;
        }
        if (Array.isArray(section.content)) {
          totalWords += section.content
            .filter(item => typeof item === 'string')
            .join(' ')
            .split(/\s+/)
            .filter(Boolean).length;
        }
        if (section.items) {
          section.items.forEach(item => {
            totalWords += (item.title + ' ' + item.description).split(' ').length;
          });
        }
        if (section.steps) {
          section.steps.forEach(step => {
            totalWords += (step.title + ' ' + step.description).split(' ').length;
          });
        }
      });
    }
    
    if (script.conclusion) {
      totalWords += String(script.conclusion.finalThought || '').split(/\s+/).filter(Boolean).length;
    }
    
    // Convert to duration (150 words per minute)
    return Math.max(30, Math.ceil((totalWords / 150) * 60));
  }

  async addAudioToVideo(videoPath, audioPath, outputPath) {
    const hasRealAudio = await this.isUsableAudioFile(audioPath);

    if (!hasRealAudio) {
      this.logger.warn('No narration audio available — producing silent video. Configure OpenAI, ElevenLabs, or Azure Speech for narration.');
      if (videoPath !== outputPath) {
        await fs.copyFile(videoPath, outputPath);
      }
      return outputPath;
    }

    // FFmpeg cannot write to its own input, so mux to a temp file when paths collide
    const muxPath = outputPath === videoPath
      ? outputPath.replace(/\.mp4$/i, '_muxed.mp4')
      : outputPath;

    await runFFmpeg(['-y', '-i', videoPath, '-i', audioPath, '-c:v', 'copy', '-c:a', 'aac', '-shortest', muxPath]);

    if (muxPath !== outputPath) {
      await fs.rename(muxPath, outputPath);
    }

    this.logger.info('Audio added to video successfully');
    return outputPath;
  }

  async isUsableAudioFile(audioPath) {
    if (typeof audioPath !== 'string' || audioPath.endsWith('.info')) {
      return false;
    }

    try {
      const stats = await fs.stat(audioPath);
      return stats.isFile() && stats.size > 0;
    } catch (error) {
      return false;
    }
  }

  async downloadVideo(url, outputPath) {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const writer = require('fs').createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  async cleanupDirectory(dirPath) {
    try {
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        await fs.unlink(path.join(dirPath, file));
      }
      await fs.rmdir(dirPath);
    } catch (error) {
      this.logger.warn('Cleanup failed:', error.message);
    }
  }

  async generateThumbnail(script, style = "ethereal") {
    this.logger.info('Generating custom thumbnail...');

    try {
      if (!this.openai && !this.gemini) {
        return await this.simulateThumbnailGeneration(script, style);
      }

      const biologyMode = String(process.env.BLAIZE_BIOLOGY_MODE || '').toLowerCase() === 'true';
      const prompt = biologyMode
        ? `Create a 16:9 YouTube thumbnail background for the Biology lesson "${script.title}". Use an accurate subject-specific visual, deep green-black, turquoise linework, warm academic-paper tones and restrained torch-flame orange/yellow accents. Heritage academic mood, high contrast, clear focal point, generous negative space for a short title. Do not draw a logo. Do not use generic DNA, microscopes or cells unless they are scientifically relevant to this exact topic. No small text, no fake labels, no sensational faces, no visual clutter.`
        : `YouTube thumbnail for "${script.title}", ${style} style, eye-catching, high contrast text, professional design, clickable, engaging`;
      const thumbnailPath = path.join(__dirname, '..', 'uploads', 'thumbnails', `thumbnail_${Date.now()}.png`);

      await this.generateImage(prompt, thumbnailPath);

      return {
        path: thumbnailPath,
        dimensions: { width: 1536, height: 1024 },
        fileSize: await this.getFileSize(thumbnailPath)
      };
    } catch (error) {
      this.logger.error('Thumbnail generation failed:', error);
      return await this.simulateThumbnailGeneration(script, style);
    }
  }

  async getFileSize(filePath) {
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  // Simulation methods for when APIs are not available
  async simulateTTSGeneration(text, outputPath) {
    this.logger.info('Simulating TTS generation...');
    
    const infoPath = outputPath + '.info';
    await fs.writeFile(infoPath, JSON.stringify({
      message: 'AI TTS audio would be generated here',
      text: text.substring(0, 100) + '...',
      timestamp: new Date().toISOString()
    }, null, 2));
    
    return infoPath;
  }

  async simulateVisualAssets(prompt, style, count) {
    this.logger.info(`Simulating ${count} visual assets...`);
    
    const paths = [];
    for (let i = 0; i < count; i++) {
      const assetPath = path.join(__dirname, '..', 'data', 'assets', `visual_sim_${Date.now()}_${i}.info`);
      
      await fs.writeFile(assetPath, JSON.stringify({
        message: 'AI visual asset would be generated here',
        prompt: prompt,
        style: style,
        timestamp: new Date().toISOString()
      }, null, 2));
      
      paths.push(assetPath);
    }
    
    return paths;
  }

  async simulateVideoGeneration(script, visualAssets, audioPath, outputPath) {
    this.logger.info('Simulating video generation...');
    
    const infoPath = outputPath + '.info';
    await fs.writeFile(infoPath, JSON.stringify({
      message: 'AI video would be generated here',
      script: script.title,
      visualAssets: visualAssets.length,
      audioPath: audioPath,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    return infoPath;
  }

  async simulateThumbnailGeneration(script, style) {
    this.logger.info('Simulating thumbnail generation...');
    
    const thumbnailPath = path.join(__dirname, '..', 'uploads', 'thumbnails', `thumbnail_sim_${Date.now()}.info`);
    await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
    
    await fs.writeFile(thumbnailPath, JSON.stringify({
      message: 'AI thumbnail would be generated here',
      title: script.title,
      style: style,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    return {
      path: thumbnailPath,
      dimensions: { width: 1792, height: 1024 },
      fileSize: 1024,
      simulated: true
    };
  }
}

module.exports = { AIVideoGenerator };
