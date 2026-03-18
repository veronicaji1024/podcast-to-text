/**
 * Podcast Service
 * Handles podcast link analysis and audio extraction from various platforms
 */

const axios = require('axios');
const cheerio = require('cheerio');
const xml2js = require('xml2js');
const path = require('path');
const fs = require('fs');

const { downloadFile, retry, formatDuration } = require('../utils');

/**
 * Validate URL to prevent SSRF attacks
 * Blocks internal/private network addresses
 */
function validateUrl(url) {
    try {
        const parsed = new URL(url);

        // Only allow http and https
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('只支持 HTTP/HTTPS 协议');
        }

        const hostname = parsed.hostname.toLowerCase();

        // Block localhost and loopback (IPv4 and IPv6)
        if (hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '::1' ||
            hostname === '0:0:0:0:0:0:0:1' ||
            hostname.endsWith('.localhost') ||
            /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) || // All 127.x.x.x
            /^::ffff:127\./.test(hostname)) { // IPv4-mapped IPv6 loopback
            throw new Error('不允许访问本地地址');
        }

        // Block IPv6 loopback and link-local
        if (hostname.startsWith('fe80:') || // Link-local
            hostname.startsWith('::ffff:') || // IPv4-mapped
            hostname === '::' || // Unspecified
            hostname.startsWith('fc00:') || hostname.startsWith('fd00:')) { // Unique local
            throw new Error('不允许访问本地地址');
        }

        // Block private IP ranges (IPv4)
        const privatePatterns = [
            /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,           // 10.0.0.0/8
            /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
            /^192\.168\.\d{1,3}\.\d{1,3}$/,              // 192.168.0.0/16
            /^169\.254\.\d{1,3}\.\d{1,3}$/,              // Link-local 169.254.0.0/16
            /^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,            // 0.0.0.0/8
            /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/, // CGNAT 100.64.0.0/10
            /^192\.0\.0\.\d{1,3}$/,                      // IETF Protocol Assignments
            /^192\.0\.2\.\d{1,3}$/,                      // TEST-NET-1
            /^198\.51\.100\.\d{1,3}$/,                   // TEST-NET-2
            /^203\.0\.113\.\d{1,3}$/,                    // TEST-NET-3
            /^224\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,          // Multicast
            /^2(2[4-9]|[3-4]\d|5[0-5])\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // All multicast/reserved
            /^255\.255\.255\.255$/                       // Broadcast
        ];

        if (privatePatterns.some(pattern => pattern.test(hostname))) {
            throw new Error('不允许访问内部网络地址');
        }

        // Block cloud metadata endpoints
        if (hostname === '169.254.169.254' ||
            hostname === 'metadata.google.internal' ||
            hostname === 'metadata.google.com' ||
            hostname === 'metadata' ||
            hostname.endsWith('.internal') ||
            hostname.endsWith('.local')) {
            throw new Error('不允许访问元数据服务');
        }

        // Additional check: validate port is not commonly used for internal services
        const port = parsed.port;
        if (port) {
            const portNum = parseInt(port);
            const restrictedPorts = [
                22,    // SSH
                23,    // Telnet
                25,    // SMTP
                3306,  // MySQL
                5432,  // PostgreSQL
                6379,  // Redis
                27017, // MongoDB
                9200,  // Elasticsearch
            ];
            if (restrictedPorts.includes(portNum)) {
                console.warn(`Warning: Accessing potentially internal service on port ${portNum}`);
            }
        }

        return true;
    } catch (error) {
        if (error.message.startsWith('不允许') || error.message.startsWith('只支持')) {
            throw error;
        }
        throw new Error('无效的 URL 格式');
    }
}

class PodcastService {
    constructor() {
        this.parser = new xml2js.Parser({ explicitArray: false });
    }

    /**
     * Extract podcast info from URL
     * Supports: Apple Podcasts, Xiaoyuzhoufm, RSS feeds, direct audio URLs
     */
    async extractPodcastInfo(url) {
        // Validate URL to prevent SSRF
        validateUrl(url);

        const platform = this.detectPlatform(url);

        console.log(`Detected platform: ${platform} for URL: ${url}`);

        switch (platform) {
            case 'apple':
                return this.extractApplePodcast(url);
            case 'xiaoyuzhou':
                return this.extractXiaoyuzhou(url);
            case 'rss':
                return this.extractFromRss(url);
            case 'audio':
                return this.extractDirectAudio(url);
            default:
                // Try generic extraction
                return this.extractGeneric(url);
        }
    }

    /**
     * Detect platform from URL
     */
    detectPlatform(url) {
        const lowerUrl = url.toLowerCase();
        
        if (lowerUrl.includes('podcasts.apple.com') || lowerUrl.includes('itunes.apple.com')) {
            return 'apple';
        }
        
        if (lowerUrl.includes('xiaoyuzhoufm.com') || lowerUrl.includes('xyzfm.link')) {
            return 'xiaoyuzhou';
        }
        
        if (lowerUrl.includes('.rss') || lowerUrl.includes('feed.xml') || lowerUrl.includes('/feed')) {
            return 'rss';
        }
        
        // Check if it's a direct audio file
        const audioExtensions = ['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac'];
        if (audioExtensions.some(ext => lowerUrl.endsWith(ext))) {
            return 'audio';
        }
        
        // Default to generic
        return 'generic';
    }

    /**
     * Extract Apple Podcast info
     */
    async extractApplePodcast(url) {
        try {
            // Apple Podcasts URL 格式:
            // https://podcasts.apple.com/cn/podcast/episode-name/id1234567890?i=1000123456789
            // 或 https://podcasts.apple.com/podcast/id1234567890

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                },
                timeout: 30000
            });

            const $ = cheerio.load(response.data);

            // Extract metadata
            const title = $('h1').first().text().trim() ||
                         $('meta[property="og:title"]').attr('content') ||
                         'Unknown Podcast';

            const description = $('meta[name="description"]').attr('content') ||
                               $('meta[property="og:description"]').attr('content') ||
                               '';

            const cover = $('meta[property="og:image"]').attr('content') || '';

            const author = $('.product-creator, [data-testid="creator-name"]').first().text().trim() || '';

            // 尝试从 URL 提取 podcast ID 和 episode ID
            const podcastIdMatch = url.match(/id(\d+)/);
            const episodeIdMatch = url.match(/[?&]i=(\d+)/);
            const podcastId = podcastIdMatch ? podcastIdMatch[1] : null;
            const episodeId = episodeIdMatch ? episodeIdMatch[1] : null;

            let rssUrl = null;
            let audioUrl = null;

            // 方法1: 使用 iTunes Search API 获取 RSS
            if (podcastId) {
                try {
                    const lookupUrl = `https://itunes.apple.com/lookup?id=${podcastId}&entity=podcast`;
                    const lookupResponse = await axios.get(lookupUrl, { timeout: 10000 });

                    if (lookupResponse.data?.results?.[0]?.feedUrl) {
                        rssUrl = lookupResponse.data.results[0].feedUrl;
                        console.log(`Found RSS URL: ${rssUrl}`);
                    }
                } catch (e) {
                    console.log('iTunes lookup failed:', e.message);
                }
            }

            // 方法2: 从页面中查找 RSS 链接
            if (!rssUrl) {
                const rssLink = $('link[type="application/rss+xml"]').attr('href');
                if (rssLink) {
                    rssUrl = rssLink;
                }
            }

            // 从 RSS 获取音频
            if (rssUrl) {
                try {
                    const rssInfo = await this.extractFromRss(rssUrl);

                    // 如果有特定的 episode ID，尝试匹配
                    if (episodeId && rssInfo.allEpisodes) {
                        const targetEpisode = rssInfo.allEpisodes.find(ep =>
                            ep.guid?.includes(episodeId) || ep.id === episodeId
                        );
                        if (targetEpisode) {
                            audioUrl = targetEpisode.audioUrl;
                        }
                    }

                    // 否则使用最新一集
                    if (!audioUrl) {
                        audioUrl = rssInfo.audioUrl;
                    }

                    // 使用 RSS 中的元数据
                    if (rssInfo.metadata) {
                        return {
                            platform: 'apple',
                            audioUrl,
                            rssUrl,
                            metadata: {
                                ...rssInfo.metadata,
                                sourceUrl: url
                            }
                        };
                    }
                } catch (e) {
                    console.log('Failed to extract from RSS:', e.message);
                }
            }

            // 方法3: 从页面脚本中查找音频 URL
            if (!audioUrl) {
                $('script').each((i, elem) => {
                    const scriptContent = $(elem).html();
                    if (scriptContent && scriptContent.includes('assetUrl')) {
                        const match = scriptContent.match(/"assetUrl"\s*:\s*"([^"]+\.m4a[^"]*)"/);
                        if (match && !audioUrl) {
                            audioUrl = match[1].replace(/\\/g, '');
                        }
                    }
                });
            }

            // 方法4: 查找 audio 元素
            if (!audioUrl) {
                const audioElement = $('audio source').attr('src') || $('audio').attr('src');
                if (audioElement) {
                    audioUrl = audioElement;
                }
            }

            return {
                platform: 'apple',
                audioUrl,
                rssUrl,
                metadata: {
                    title,
                    description,
                    cover,
                    author,
                    sourceUrl: url
                }
            };

        } catch (error) {
            console.error('Apple podcast extraction error:', error);
            throw new Error(`无法解析 Apple Podcasts 链接: ${error.message}`);
        }
    }

    /**
     * Extract Xiaoyuzhou (小宇宙) podcast info
     */
    async extractXiaoyuzhou(url) {
        try {
            // Handle different xiaoyuzhou URL formats
            // https://www.xiaoyuzhoufm.com/episode/xxx
            // https://xyzfm.link/xxx or https://xyzfm.link/s/xxx

            let episodeId = null;
            let finalUrl = url;

            // 如果是短链接，先获取重定向后的真实链接
            if (url.includes('xyzfm.link')) {
                try {
                    const redirectResponse = await axios.get(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
                        },
                        maxRedirects: 5,
                        timeout: 10000
                    });
                    finalUrl = redirectResponse.request.res.responseUrl || url;
                    console.log(`Redirected to: ${finalUrl}`);
                } catch (e) {
                    console.log('Redirect failed, using original URL');
                }
            }

            // 从 URL 提取 episode ID
            const episodeMatch = finalUrl.match(/episode\/([a-zA-Z0-9]+)/);
            if (episodeMatch) {
                episodeId = episodeMatch[1];
            }

            console.log(`Xiaoyuzhou episode ID: ${episodeId}`);

            // 方法1: 尝试通过 API 获取（新版 API）
            if (episodeId) {
                try {
                    // 尝试新版 GraphQL API
                    const graphqlResponse = await axios.post('https://www.xiaoyuzhoufm.com/api/v1/episode/get', {
                        eid: episodeId
                    }, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        timeout: 15000
                    });

                    if (graphqlResponse.data && graphqlResponse.data.data) {
                        const episode = graphqlResponse.data.data;
                        const audioUrl = episode.enclosure?.url || episode.mediaKey;

                        if (audioUrl) {
                            // 处理可能的 CDN URL
                            let fullAudioUrl = audioUrl;
                            if (audioUrl.startsWith('//')) {
                                fullAudioUrl = 'https:' + audioUrl;
                            } else if (!audioUrl.startsWith('http')) {
                                fullAudioUrl = `https://media.xyzcdn.net/${audioUrl}`;
                            }

                            return {
                                platform: 'xiaoyuzhou',
                                audioUrl: fullAudioUrl,
                                metadata: {
                                    title: episode.title || 'Unknown Episode',
                                    description: episode.description || episode.shownotes || '',
                                    cover: episode.image?.picUrl || episode.podcast?.image?.picUrl || '',
                                    author: episode.podcast?.title || '',
                                    duration: episode.duration,
                                    date: episode.pubDate,
                                    sourceUrl: url
                                }
                            };
                        }
                    }
                } catch (apiError) {
                    console.log('New API failed:', apiError.message);
                }
            }

            // 方法2: 网页解析
            const response = await axios.get(finalUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                },
                timeout: 30000
            });

            const $ = cheerio.load(response.data);

            // Extract metadata
            const title = $('h1').first().text().trim() ||
                         $('meta[property="og:title"]').attr('content') ||
                         'Unknown Episode';

            const description = $('meta[name="description"]').attr('content') ||
                               $('meta[property="og:description"]').attr('content') ||
                               '';

            const cover = $('meta[property="og:image"]').attr('content') || '';

            const author = $('.podcast-name, [data-testid="podcast-name"]').first().text().trim() || '';

            // Try to find audio URL
            let audioUrl = null;

            // 方法2a: 查找 __NEXT_DATA__ 中的数据
            const nextDataScript = $('#__NEXT_DATA__').html();
            if (nextDataScript) {
                try {
                    const nextData = JSON.parse(nextDataScript);
                    const episodeData = nextData?.props?.pageProps?.episode ||
                                       nextData?.props?.pageProps?.data;
                    if (episodeData) {
                        audioUrl = episodeData.enclosure?.url ||
                                  episodeData.mediaKey ||
                                  episodeData.audioUrl;

                        if (audioUrl && !audioUrl.startsWith('http')) {
                            if (audioUrl.startsWith('//')) {
                                audioUrl = 'https:' + audioUrl;
                            } else {
                                audioUrl = `https://media.xyzcdn.net/${audioUrl}`;
                            }
                        }
                    }
                } catch (e) {
                    console.log('Failed to parse __NEXT_DATA__:', e.message);
                }
            }

            // 方法2b: 查找 audio 元素
            if (!audioUrl) {
                const audioSrc = $('audio source').attr('src') || $('audio').attr('src');
                if (audioSrc) {
                    audioUrl = audioSrc;
                }
            }

            // 方法2c: 在脚本中查找
            if (!audioUrl) {
                $('script').each((i, elem) => {
                    const scriptContent = $(elem).html();
                    if (scriptContent && (scriptContent.includes('enclosure') || scriptContent.includes('mediaKey'))) {
                        // 查找 enclosure URL
                        let match = scriptContent.match(/"enclosure"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/);
                        if (match && !audioUrl) {
                            audioUrl = match[1].replace(/\\/g, '');
                        }
                        // 查找 mediaKey
                        if (!audioUrl) {
                            match = scriptContent.match(/"mediaKey"\s*:\s*"([^"]+)"/);
                            if (match) {
                                audioUrl = `https://media.xyzcdn.net/${match[1]}`;
                            }
                        }
                    }
                });
            }

            // 验证 audioUrl
            if (audioUrl && audioUrl.startsWith('//')) {
                audioUrl = 'https:' + audioUrl;
            }

            return {
                platform: 'xiaoyuzhou',
                audioUrl,
                metadata: {
                    title,
                    description,
                    cover,
                    author,
                    sourceUrl: url
                }
            };

        } catch (error) {
            console.error('Xiaoyuzhou extraction error:', error);
            throw new Error(`无法解析小宇宙链接: ${error.message}`);
        }
    }

    /**
     * Extract info from RSS feed
     */
    async extractFromRss(rssUrl) {
        try {
            const response = await axios.get(rssUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 30000
            });

            const result = await this.parser.parseStringPromise(response.data);
            
            const channel = result.rss?.channel || result.feed;
            if (!channel) {
                throw new Error('Invalid RSS feed format');
            }

            // Get podcast metadata
            const podcastTitle = channel.title || 'Unknown Podcast';
            const podcastDescription = channel.description || '';
            const podcastAuthor = channel.author || channel['itunes:author'] || '';
            const podcastCover = channel.image?.url || 
                                channel['itunes:image']?.$?.href || 
                                '';

            // Get latest episode
            const items = Array.isArray(channel.item) ? channel.item : [channel.item];
            const latestEpisode = items[0];

            if (!latestEpisode) {
                throw new Error('No episodes found in RSS feed');
            }

            // Extract episode info
            const episodeTitle = latestEpisode.title || 'Unknown Episode';
            const episodeDescription = latestEpisode.description || 
                                     latestEpisode['itunes:summary'] || 
                                     latestEpisode['content:encoded'] || 
                                     '';
            
            const episodeDate = latestEpisode.pubDate || '';
            const episodeDuration = latestEpisode['itunes:duration'] || '';

            // Get audio URL
            let audioUrl = null;
            
            if (latestEpisode.enclosure) {
                if (Array.isArray(latestEpisode.enclosure)) {
                    audioUrl = latestEpisode.enclosure[0].$.url;
                } else {
                    audioUrl = latestEpisode.enclosure.$.url;
                }
            }

            if (!audioUrl && latestEpisode.guid) {
                // Some feeds put audio URL in guid
                const guid = latestEpisode.guid;
                if (typeof guid === 'string' && guid.match(/\.(mp3|m4a|wav)$/i)) {
                    audioUrl = guid;
                } else if (guid._ && guid.$.isPermaLink === 'true') {
                    audioUrl = guid._;
                }
            }

            // Clean up audio URL
            if (audioUrl) {
                audioUrl = audioUrl.replace(/\?.*$/, ''); // Remove query params
            }

            return {
                platform: 'rss',
                audioUrl,
                rssUrl,
                metadata: {
                    title: `${podcastTitle} - ${episodeTitle}`,
                    description: episodeDescription,
                    cover: podcastCover,
                    author: podcastAuthor,
                    duration: episodeDuration,
                    date: episodeDate,
                    sourceUrl: rssUrl
                }
            };

        } catch (error) {
            console.error('RSS extraction error:', error);
            throw new Error(`无法解析 RSS 订阅: ${error.message}`);
        }
    }

    /**
     * Extract direct audio URL info
     */
    async extractDirectAudio(url) {
        // Try to get audio metadata
        let metadata = {
            title: path.basename(url, path.extname(url)),
            description: '',
            cover: '',
            author: '',
            sourceUrl: url
        };

        // Try to fetch headers to get content info
        try {
            const response = await axios.head(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });

            const contentLength = response.headers['content-length'];
            if (contentLength) {
                metadata.fileSize = parseInt(contentLength);
            }
        } catch (e) {
            // Ignore header fetch errors
        }

        return {
            platform: 'audio',
            audioUrl: url,
            metadata
        };
    }

    /**
     * Generic extraction - try to find audio in any page
     */
    async extractGeneric(url) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 30000,
                maxRedirects: 5
            });

            const $ = cheerio.load(response.data);
            
            // Extract basic metadata
            const title = $('title').text().trim() || 
                         $('meta[property="og:title"]').attr('content') || 
                         'Unknown';
            
            const description = $('meta[name="description"]').attr('content') || 
                               $('meta[property="og:description"]').attr('content') || 
                               '';
            
            const cover = $('meta[property="og:image"]').attr('content') || '';

            // Try to find audio URL
            let audioUrl = null;
            
            // Check for audio elements
            const audioSrc = $('audio source').attr('src');
            if (audioSrc) {
                audioUrl = new URL(audioSrc, url).href;
            }
            
            // Check for links to audio files
            if (!audioUrl) {
                $('a').each((i, elem) => {
                    const href = $(elem).attr('href');
                    if (href && href.match(/\.(mp3|m4a|wav|aac|ogg)$/i)) {
                        audioUrl = new URL(href, url).href;
                        return false; // Break loop
                    }
                });
            }

            // Check for RSS feed link
            let rssUrl = null;
            const rssLink = $('link[type="application/rss+xml"]').attr('href');
            if (rssLink) {
                rssUrl = new URL(rssLink, url).href;
                
                // Try to extract from RSS
                try {
                    const rssInfo = await this.extractFromRss(rssUrl);
                    if (rssInfo.audioUrl) {
                        return rssInfo;
                    }
                } catch (e) {
                    console.log('RSS extraction failed:', e.message);
                }
            }

            if (!audioUrl) {
                throw new Error('无法在此页面找到音频文件');
            }

            return {
                platform: 'generic',
                audioUrl,
                rssUrl,
                metadata: {
                    title,
                    description,
                    cover,
                    author: '',
                    sourceUrl: url
                }
            };

        } catch (error) {
            console.error('Generic extraction error:', error);
            throw new Error(`无法解析链接: ${error.message}`);
        }
    }

    /**
     * Download audio file
     */
    async downloadAudio(audioUrl, outputPath, onProgress) {
        console.log(`Downloading audio from: ${audioUrl}`);
        
        try {
            await retry(async () => {
                await downloadFile(audioUrl, outputPath, onProgress);
            }, 3, 2000);

            // Verify file was downloaded
            const stats = fs.statSync(outputPath);
            if (stats.size === 0) {
                throw new Error('下载的文件为空');
            }

            console.log(`Audio downloaded: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

        } catch (error) {
            console.error('Download error:', error);
            throw new Error(`音频下载失败: ${error.message}`);
        }
    }
}

module.exports = new PodcastService();
