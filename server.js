const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', ffmpeg: true });
});

app.post('/convert', upload.single('audio'), async (req, res) => {
    const format = req.query.format || 'ogg';
    const bitrate = req.query.bitrate || '128k';

    if (!['ogg', 'mp3', 'opus', 'm4a', 'aac'].includes(format)) {
        return res.status(400).json({ error: 'Invalid format. Supported: ogg, mp3, opus, m4a, aac' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
    }

    const tempId = uuidv4();

    let inputExt = '';
    if (req.file.originalname) {
        const match = req.file.originalname.match(/\.(\w+)$/);
        if (match) inputExt = match[1];
    }
    if (!inputExt && req.file.mimetype) {
        const mimeToExt = {
            'audio/mpeg': 'mp3',
            'audio/mp3': 'mp3',
            'audio/wav': 'wav',
            'audio/wave': 'wav',
            'audio/x-wav': 'wav',
            'audio/ogg': 'ogg',
            'audio/flac': 'flac',
            'audio/aac': 'aac',
            'audio/mp4': 'm4a',
            'audio/x-m4a': 'm4a',
            'audio/webm': 'webm',
            'video/webm': 'webm'
        };
        inputExt = mimeToExt[req.file.mimetype] || '';
    }

    const inputPath = `/tmp/${tempId}_input${inputExt ? '.' + inputExt : ''}`;
    const outputPath = `/tmp/${tempId}_output.${format}`;

    try {
        fs.writeFileSync(inputPath, req.file.buffer);

        let codecArgs;
        switch (format) {
            case 'mp3':
                codecArgs = `-c:a libmp3lame -b:a ${bitrate}`;
                break;
            case 'ogg':
                codecArgs = `-c:a libvorbis -b:a ${bitrate}`;
                break;
            case 'opus':
                codecArgs = `-c:a libopus -b:a ${bitrate}`;
                break;
            case 'm4a':
            case 'aac':
                codecArgs = `-c:a aac -b:a ${bitrate}`;
                break;
            default:
                codecArgs = `-c:a libvorbis -b:a ${bitrate}`;
        }

        const cmd = `ffmpeg -i "${inputPath}" ${codecArgs} -y "${outputPath}"`;

        console.log(`Converting: ${req.file.originalname || 'unknown'} (${req.file.mimetype}) -> ${format}`);
        console.log(`Command: ${cmd}`);

        try {
            const output = execSync(cmd, {
                maxBuffer: 50 * 1024 * 1024,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
        } catch (ffmpegError) {
            console.error('FFmpeg stderr:', ffmpegError.stderr || ffmpegError.message);
            return res.status(500).json({
                error: 'Conversion failed',
                details: ffmpegError.stderr || ffmpegError.message,
                input: {
                    originalName: req.file.originalname,
                    mimetype: req.file.mimetype,
                    size: req.file.size
                }
            });
        }

        const convertedBuffer = fs.readFileSync(outputPath);

        const contentTypes = {
            'mp3': 'audio/mpeg',
            'ogg': 'audio/ogg',
            'opus': 'audio/opus',
            'm4a': 'audio/mp4',
            'aac': 'audio/aac'
        };

        res.set('Content-Type', contentTypes[format] || 'audio/ogg');
        res.set('Content-Length', convertedBuffer.length);
        res.send(convertedBuffer);

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    } finally {
        try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
        }
    }
});

app.post('/convert-base64', express.json({ limit: '500mb' }), async (req, res) => {
    const { audio, format = 'ogg', bitrate = '128k' } = req.body;

    if (!audio) {
        return res.status(400).json({ error: 'No audio data provided' });
    }

    const tempId = uuidv4();
    const inputPath = `/tmp/${tempId}_input`;
    const outputPath = `/tmp/${tempId}_output.${format}`;

    try {
        const inputBuffer = Buffer.from(audio, 'base64');
        fs.writeFileSync(inputPath, inputBuffer);

        let codecArgs;
        switch (format) {
            case 'mp3':
                codecArgs = `-c:a libmp3lame -b:a ${bitrate}`;
                break;
            case 'ogg':
                codecArgs = `-c:a libvorbis -b:a ${bitrate}`;
                break;
            default:
                codecArgs = `-c:a libvorbis -b:a ${bitrate}`;
        }

        execSync(`ffmpeg -i ${inputPath} ${codecArgs} -y ${outputPath}`, {
            maxBuffer: 50 * 1024 * 1024
        });

        const convertedBuffer = fs.readFileSync(outputPath);

        res.json({
            audio: convertedBuffer.toString('base64'),
            format: format,
            size: convertedBuffer.length
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (e) { }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`FFmpeg Audio Converter API running on port ${PORT}`);
    console.log(`Endpoints:`);
    console.log(`  GET  /health - Health check`);
    console.log(`  POST /convert?format=ogg|mp3&bitrate=128k - Convert audio file`);
    console.log(`  POST /convert-base64 - Convert base64 audio`);
});