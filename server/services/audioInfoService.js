/**
 * Audio Info Service
 * Retrieves metadata and information from audio files
 */

const fs = require('fs').promises;
const path = require('path');
const { execPromise } = require('../utils');

class AudioInfoService {
    /**
     * Get audio file information
     */
    async getAudioInfo(audioPath) {
        const info = {
            duration: 0,
            bitrate: 0,
            sampleRate: 0,
            channels: 0,
            format: '',
            size: 0
        };

        try {
            // Get file size
            const stats = await fs.stat(audioPath);
            info.size = stats.size;

            // Try to use ffprobe if available
            try {
                const ffprobeInfo = await this.getFFprobeInfo(audioPath);
                Object.assign(info, ffprobeInfo);
            } catch (ffprobeError) {
                console.log('FFprobe not available, using fallback method');
                
                // Fallback: estimate duration from file size
                // This is rough but better than nothing
                info.duration = await this.estimateDuration(audioPath);
            }

            // Get format from extension
            info.format = path.extname(audioPath).toLowerCase().replace('.', '');

        } catch (error) {
            console.error('Error getting audio info:', error);
        }

        return info;
    }

    /**
     * Get audio info using ffprobe
     */
    async getFFprobeInfo(audioPath) {
        try {
            const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${audioPath}"`;
            const { stdout } = await execPromise(command);
            
            const data = JSON.parse(stdout);
            const format = data.format;
            const audioStream = data.streams?.find(s => s.codec_type === 'audio');

            return {
                duration: parseFloat(format.duration) || 0,
                bitrate: parseInt(format.bit_rate) || 0,
                sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate) : 0,
                channels: audioStream?.channels || 0,
                format: format.format_name?.split(',')[0] || ''
            };

        } catch (error) {
            throw new Error(`FFprobe failed: ${error.message}`);
        }
    }

    /**
     * Estimate audio duration from file size
     * This is a rough estimate based on typical bitrates
     */
    async estimateDuration(audioPath) {
        try {
            const stats = await fs.stat(audioPath);
            const sizeInBits = stats.size * 8;
            
            // Estimate based on file extension
            const ext = path.extname(audioPath).toLowerCase();
            
            // Typical bitrates (bits per second)
            const typicalBitrates = {
                '.mp3': 128000,    // 128 kbps
                '.m4a': 128000,    // 128 kbps
                '.aac': 128000,    // 128 kbps
                '.ogg': 128000,    // 128 kbps
                '.wav': 1411200,   // CD quality
                '.flac': 700000,   // Variable, estimate
            };
            
            const bitrate = typicalBitrates[ext] || 128000;
            const duration = sizeInBits / bitrate;
            
            return Math.round(duration);

        } catch (error) {
            console.error('Error estimating duration:', error);
            return 0;
        }
    }

    /**
     * Get audio duration using Python mutagen (if available)
     */
    async getDurationWithMutagen(audioPath) {
        try {
            const script = `
import sys
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4
from mutagen.oggvorbis import OggVorbis
from mutagen.flac import FLAC
from mutagen.wave import WAVE

path = sys.argv[1]
ext = path.lower().split('.')[-1]

try:
    if ext == 'mp3':
        audio = MP3(path)
    elif ext in ['m4a', 'mp4']:
        audio = MP4(path)
    elif ext == 'ogg':
        audio = OggVorbis(path)
    elif ext == 'flac':
        audio = FLAC(path)
    elif ext == 'wav':
        audio = WAVE(path)
    else:
        print(0)
        sys.exit(0)
    
    print(int(audio.info.length))
except Exception as e:
    print(0)
`;
            const tempScript = path.join(require('os').tmpdir(), 'get_duration.py');
            await fs.writeFile(tempScript, script);
            
            const { stdout } = await execPromise(`python3 "${tempScript}" "${audioPath}"`);
            
            // Cleanup
            await fs.unlink(tempScript).catch(() => {});
            
            return parseInt(stdout.trim()) || 0;

        } catch (error) {
            console.log('Mutagen not available');
            return 0;
        }
    }

    /**
     * Validate audio file
     */
    async validateAudio(audioPath) {
        const issues = [];

        try {
            const stats = await fs.stat(audioPath);
            
            // Check if file is empty
            if (stats.size === 0) {
                issues.push('Audio file is empty');
            }

            // Check file size (warn if very large)
            const sizeInMB = stats.size / (1024 * 1024);
            if (sizeInMB > 500) {
                issues.push(`Very large file (${sizeInMB.toFixed(1)} MB), processing may take a while`);
            }

            // Try to get audio info
            const info = await this.getAudioInfo(audioPath);
            
            if (info.duration === 0) {
                issues.push('Could not determine audio duration');
            }

            if (info.duration > 7200) { // 2 hours
                issues.push(`Long audio (${Math.round(info.duration / 60)} minutes), processing will take significant time`);
            }

            return {
                valid: issues.length === 0 || !issues.some(i => i.includes('empty')),
                info,
                issues
            };

        } catch (error) {
            return {
                valid: false,
                info: null,
                issues: [`Failed to validate audio: ${error.message}`]
            };
        }
    }

    /**
     * Format duration for display
     */
    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Bytes';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
    }
}

module.exports = new AudioInfoService();
