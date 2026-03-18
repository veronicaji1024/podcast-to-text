/**
 * RSS Parser Service
 * Handles RSS feed parsing and extraction
 */

const axios = require('axios');
const xml2js = require('xml2js');

class RSSParser {
    constructor() {
        this.parser = new xml2js.Parser({
            explicitArray: false,
            mergeAttrs: true,
            explicitRoot: false
        });
    }

    /**
     * Parse RSS feed from URL
     */
    async parseURL(url) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/rss+xml, application/xml, text/xml, */*'
                },
                timeout: 30000,
                maxRedirects: 5
            });

            return this.parseXML(response.data);

        } catch (error) {
            console.error('RSS fetch error:', error.message);
            throw new Error(`Failed to fetch RSS feed: ${error.message}`);
        }
    }

    /**
     * Parse RSS XML content
     */
    async parseXML(xmlContent) {
        try {
            const result = await this.parser.parseStringPromise(xmlContent);
            
            // Handle both RSS 2.0 and Atom formats
            if (result.rss) {
                return this.parseRSS20(result.rss);
            } else if (result.feed) {
                return this.parseAtom(result.feed);
            } else {
                throw new Error('Unknown feed format');
            }

        } catch (error) {
            console.error('RSS parse error:', error.message);
            throw new Error(`Failed to parse RSS feed: ${error.message}`);
        }
    }

    /**
     * Parse RSS 2.0 format
     */
    parseRSS20(rss) {
        const channel = rss.channel;
        
        if (!channel) {
            throw new Error('Invalid RSS 2.0 format: no channel element');
        }

        // Parse podcast info
        const podcast = {
            title: this.getText(channel.title),
            description: this.getText(channel.description),
            link: this.getText(channel.link),
            language: this.getText(channel.language),
            copyright: this.getText(channel.copyright),
            lastBuildDate: this.getText(channel.lastBuildDate),
            generator: this.getText(channel.generator),
            author: this.getText(channel['itunes:author']) || this.getText(channel.author),
            categories: this.parseCategories(channel.category),
            image: this.parseImage(channel.image, channel['itunes:image']),
            explicit: this.getText(channel['itunes:explicit']),
            episodes: []
        };

        // Parse episodes
        const items = Array.isArray(channel.item) ? channel.item : [channel.item];
        
        for (const item of items) {
            if (!item) continue;
            
            const episode = this.parseEpisode(item);
            podcast.episodes.push(episode);
        }

        return podcast;
    }

    /**
     * Parse Atom format
     */
    parseAtom(feed) {
        const podcast = {
            title: this.getText(feed.title),
            description: this.getText(feed.subtitle),
            link: this.getLink(feed.link),
            updated: this.getText(feed.updated),
            author: this.parseAtomAuthor(feed.author),
            image: this.getImageFromAtom(feed),
            episodes: []
        };

        // Parse entries
        const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
        
        for (const entry of entries) {
            if (!entry) continue;
            
            const episode = this.parseAtomEntry(entry);
            podcast.episodes.push(episode);
        }

        return podcast;
    }

    /**
     * Parse RSS episode item
     */
    parseEpisode(item) {
        const episode = {
            title: this.getText(item.title),
            description: this.getText(item.description) || this.getText(item['itunes:summary']) || this.getText(item['content:encoded']),
            link: this.getText(item.link),
            guid: this.getText(item.guid),
            pubDate: this.getText(item.pubDate),
            duration: this.parseDuration(item['itunes:duration']),
            explicit: this.getText(item['itunes:explicit']),
            episodeNumber: this.getText(item['itunes:episode']),
            season: this.getText(item['itunes:season']),
            episodeType: this.getText(item['itunes:episodeType']),
            image: this.getEpisodeImage(item),
            audioUrl: this.getAudioUrl(item),
            fileSize: this.getFileSize(item),
            mimeType: this.getMimeType(item)
        };

        return episode;
    }

    /**
     * Parse Atom entry
     */
    parseAtomEntry(entry) {
        const episode = {
            title: this.getText(entry.title),
            description: this.getText(entry.summary) || this.getText(entry.content),
            link: this.getLink(entry.link),
            id: this.getText(entry.id),
            pubDate: this.getText(entry.published) || this.getText(entry.updated),
            duration: null,
            explicit: null,
            episodeNumber: null,
            season: null,
            episodeType: null,
            image: null,
            audioUrl: this.getAudioUrlFromAtom(entry),
            fileSize: null,
            mimeType: null
        };

        return episode;
    }

    /**
     * Get text value from element
     */
    getText(element) {
        if (!element) return null;
        if (typeof element === 'string') return element;
        if (typeof element === 'object') {
            // Handle _ attribute (common in xml2js)
            if (element._) return element._;
            // Handle $ (attributes)
            if (element.$) {
                // For guid with isPermaLink
                if (element.$.isPermaLink === 'true') {
                    return element._ || null;
                }
            }
        }
        return null;
    }

    /**
     * Get link from element
     */
    getLink(element) {
        if (!element) return null;
        if (typeof element === 'string') return element;
        if (Array.isArray(element)) {
            // Find alternate link
            const altLink = element.find(l => l.$.rel === 'alternate');
            return altLink?.$.href || element[0]?.$.href;
        }
        if (element.$) return element.$.href;
        return null;
    }

    /**
     * Parse categories
     */
    parseCategories(category) {
        if (!category) return [];
        if (typeof category === 'string') return [category];
        if (Array.isArray(category)) {
            return category.map(c => typeof c === 'string' ? c : c._ || c.$.text).filter(Boolean);
        }
        return [category._ || category.$.text].filter(Boolean);
    }

    /**
     * Parse image
     */
    parseImage(image, itunesImage) {
        if (itunesImage) {
            if (typeof itunesImage === 'string') return itunesImage;
            if (itunesImage.$) return itunesImage.$.href;
            if (itunesImage._) return itunesImage._;
        }
        
        if (image) {
            if (typeof image === 'string') return image;
            if (image.url) return this.getText(image.url);
            if (image.$) return image.$.href;
        }
        
        return null;
    }

    /**
     * Get episode image
     */
    getEpisodeImage(item) {
        if (item['itunes:image']) {
            const img = item['itunes:image'];
            if (typeof img === 'string') return img;
            if (img.$) return img.$.href;
        }
        return null;
    }

    /**
     * Get audio URL from item
     */
    getAudioUrl(item) {
        if (!item.enclosure) return null;
        
        const enclosure = item.enclosure;
        
        if (Array.isArray(enclosure)) {
            // Find audio enclosure
            const audioEnc = enclosure.find(e => 
                e.$.type?.startsWith('audio/') || 
                e.$.url?.match(/\.(mp3|m4a|wav|aac|ogg)$/i)
            );
            return audioEnc?.$.url;
        }
        
        if (enclosure.$) {
            return enclosure.$.url;
        }
        
        return null;
    }

    /**
     * Get audio URL from Atom entry
     */
    getAudioUrlFromAtom(entry) {
        if (!entry.link) return null;
        
        const links = Array.isArray(entry.link) ? entry.link : [entry.link];
        
        // Find enclosure link
        const enclosure = links.find(l => 
            l.$.rel === 'enclosure' || 
            l.$.type?.startsWith('audio/')
        );
        
        return enclosure?.$.href;
    }

    /**
     * Get file size
     */
    getFileSize(item) {
        if (!item.enclosure) return null;
        
        const enclosure = item.enclosure;
        
        if (Array.isArray(enclosure)) {
            const audioEnc = enclosure.find(e => e.$.type?.startsWith('audio/'));
            return audioEnc?.$.length ? parseInt(audioEnc.$.length) : null;
        }
        
        if (enclosure.$) {
            return enclosure.$.length ? parseInt(enclosure.$.length) : null;
        }
        
        return null;
    }

    /**
     * Get MIME type
     */
    getMimeType(item) {
        if (!item.enclosure) return null;
        
        const enclosure = item.enclosure;
        
        if (Array.isArray(enclosure)) {
            const audioEnc = enclosure.find(e => e.$.type?.startsWith('audio/'));
            return audioEnc?.$.type;
        }
        
        if (enclosure.$) {
            return enclosure.$.type;
        }
        
        return null;
    }

    /**
     * Parse duration string to seconds
     */
    parseDuration(duration) {
        if (!duration) return null;
        
        const durationStr = this.getText(duration);
        if (!durationStr) return null;
        
        // Handle HH:MM:SS format
        const timeMatch = durationStr.match(/(\d+):(\d+):(\d+)/);
        if (timeMatch) {
            return parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
        }
        
        // Handle MM:SS format
        const shortMatch = durationStr.match(/(\d+):(\d+)/);
        if (shortMatch) {
            return parseInt(shortMatch[1]) * 60 + parseInt(shortMatch[2]);
        }
        
        // Handle plain seconds
        const seconds = parseInt(durationStr);
        if (!isNaN(seconds)) {
            return seconds;
        }
        
        return null;
    }

    /**
     * Parse Atom author
     */
    parseAtomAuthor(author) {
        if (!author) return null;
        if (typeof author === 'string') return author;
        if (author.name) return this.getText(author.name);
        if (Array.isArray(author)) {
            return this.getText(author[0].name);
        }
        return null;
    }

    /**
     * Get image from Atom feed
     */
    getImageFromAtom(feed) {
        // Try logo first
        if (feed.logo) {
            return this.getText(feed.logo);
        }
        
        // Try icon
        if (feed.icon) {
            return this.getText(feed.icon);
        }
        
        // Try media:thumbnail or similar
        if (feed['media:thumbnail']) {
            const thumb = feed['media:thumbnail'];
            if (thumb.$) return thumb.$.url;
        }
        
        return null;
    }

    /**
     * Find podcast by search query (using iTunes API)
     */
    async searchPodcasts(query, limit = 10) {
        try {
            const encodedQuery = encodeURIComponent(query);
            const url = `https://itunes.apple.com/search?term=${encodedQuery}&media=podcast&limit=${limit}`;
            
            const response = await axios.get(url, {
                timeout: 15000
            });
            
            return response.data.results.map(item => ({
                id: item.collectionId,
                name: item.collectionName,
                artist: item.artistName,
                artwork: item.artworkUrl600 || item.artworkUrl100,
                feedUrl: item.feedUrl,
                genres: item.genres,
                url: item.collectionViewUrl
            }));

        } catch (error) {
            console.error('Podcast search error:', error.message);
            throw new Error(`Search failed: ${error.message}`);
        }
    }

    /**
     * Get podcast details from iTunes
     */
    async getPodcastById(id) {
        try {
            const url = `https://itunes.apple.com/lookup?id=${id}`;
            
            const response = await axios.get(url, {
                timeout: 15000
            });
            
            if (response.data.resultCount === 0) {
                throw new Error('Podcast not found');
            }
            
            const item = response.data.results[0];
            
            return {
                id: item.collectionId,
                name: item.collectionName,
                artist: item.artistName,
                artwork: item.artworkUrl600 || item.artworkUrl100,
                feedUrl: item.feedUrl,
                genres: item.genres,
                url: item.collectionViewUrl,
                episodeCount: item.trackCount,
                releaseDate: item.releaseDate
            };

        } catch (error) {
            console.error('Podcast lookup error:', error.message);
            throw new Error(`Lookup failed: ${error.message}`);
        }
    }
}

module.exports = new RSSParser();
