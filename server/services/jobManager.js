/**
 * JobManager - Manages job lifecycle with automatic cleanup
 * Prevents memory leaks by limiting job count and expiring old jobs
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class JobManager {
    constructor(options = {}) {
        // Job storage
        this.jobs = new Map();

        // Configuration
        this.maxJobs = options.maxJobs || 500;
        this.completedJobTTL = options.completedJobTTL || 30 * 60 * 1000;  // 30 minutes
        this.inProgressJobTTL = options.inProgressJobTTL || 2 * 60 * 60 * 1000;  // 2 hours
        this.cleanupInterval = options.cleanupInterval || 5 * 60 * 1000;  // 5 minutes

        // Start cleanup timer
        this.startCleanupTimer();

        console.log(`JobManager initialized: max ${this.maxJobs} jobs, cleanup every ${this.cleanupInterval / 1000}s`);
    }

    /**
     * Create a new job
     * @returns {Object} The created job
     */
    createJob(data = {}) {
        // Check job limit
        if (this.jobs.size >= this.maxJobs) {
            // Try to cleanup expired jobs first
            this.cleanup();

            // If still at limit, remove oldest completed jobs
            if (this.jobs.size >= this.maxJobs) {
                this.removeOldestCompletedJobs(10);
            }

            // If still at limit, reject new job
            if (this.jobs.size >= this.maxJobs) {
                throw new Error('系统繁忙，请稍后再试');
            }
        }

        const jobId = uuidv4();
        const accessToken = crypto.randomBytes(32).toString('hex');

        const job = {
            id: jobId,
            accessToken,
            status: 'pending',
            step: null,
            progress: 0,
            message: '准备开始...',
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: null,
            result: null,
            error: null,
            ...data
        };

        this.jobs.set(jobId, job);
        console.log(`Job created: ${jobId} (total: ${this.jobs.size})`);

        return job;
    }

    /**
     * Get a job by ID
     * @param {string} jobId
     * @returns {Object|null}
     */
    getJob(jobId) {
        return this.jobs.get(jobId) || null;
    }

    /**
     * Update a job
     * @param {string} jobId
     * @param {Object} updates
     * @returns {Object|null}
     */
    updateJob(jobId, updates) {
        const job = this.jobs.get(jobId);
        if (!job) return null;

        Object.assign(job, updates, { updatedAt: new Date() });

        // Track completion time
        if (updates.status === 'completed' || updates.status === 'error') {
            job.completedAt = new Date();
        }

        this.jobs.set(jobId, job);
        return job;
    }

    /**
     * Delete a job
     * @param {string} jobId
     * @returns {boolean}
     */
    deleteJob(jobId) {
        const deleted = this.jobs.delete(jobId);
        if (deleted) {
            console.log(`Job deleted: ${jobId} (remaining: ${this.jobs.size})`);
        }
        return deleted;
    }

    /**
     * Validate access token for a job
     * @param {string} jobId
     * @param {string} token
     * @returns {boolean}
     */
    validateToken(jobId, token) {
        const job = this.jobs.get(jobId);
        if (!job) return false;
        return job.accessToken === token;
    }

    /**
     * Start the cleanup timer
     */
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.cleanupInterval);

        // Don't keep process alive just for cleanup
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    /**
     * Stop the cleanup timer
     */
    stopCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * Cleanup expired jobs
     * @returns {number} Number of jobs removed
     */
    cleanup() {
        const now = Date.now();
        let removed = 0;

        for (const [jobId, job] of this.jobs.entries()) {
            const jobAge = now - new Date(job.createdAt).getTime();
            const completedAge = job.completedAt ? now - new Date(job.completedAt).getTime() : 0;

            let shouldRemove = false;

            // Remove completed/error jobs after TTL
            if ((job.status === 'completed' || job.status === 'error') && completedAge > this.completedJobTTL) {
                shouldRemove = true;
            }

            // Remove in-progress jobs that are stuck (exceeded TTL)
            if ((job.status === 'pending' || job.status === 'processing') && jobAge > this.inProgressJobTTL) {
                shouldRemove = true;
                console.warn(`Removing stuck job: ${jobId} (age: ${Math.round(jobAge / 1000 / 60)}min)`);
            }

            if (shouldRemove) {
                this.jobs.delete(jobId);
                removed++;
            }
        }

        if (removed > 0) {
            console.log(`Cleanup: removed ${removed} expired jobs (remaining: ${this.jobs.size})`);
        }

        return removed;
    }

    /**
     * Remove oldest completed jobs
     * @param {number} count Number of jobs to remove
     * @returns {number} Number of jobs removed
     */
    removeOldestCompletedJobs(count) {
        const completedJobs = [];

        for (const [jobId, job] of this.jobs.entries()) {
            if (job.status === 'completed' || job.status === 'error') {
                completedJobs.push({ jobId, createdAt: new Date(job.createdAt) });
            }
        }

        // Sort by creation time (oldest first)
        completedJobs.sort((a, b) => a.createdAt - b.createdAt);

        // Remove oldest
        const toRemove = completedJobs.slice(0, count);
        for (const { jobId } of toRemove) {
            this.jobs.delete(jobId);
        }

        if (toRemove.length > 0) {
            console.log(`Removed ${toRemove.length} oldest completed jobs to free space`);
        }

        return toRemove.length;
    }

    /**
     * Get job statistics
     * @returns {Object}
     */
    getStats() {
        let pending = 0, processing = 0, completed = 0, error = 0;

        for (const job of this.jobs.values()) {
            switch (job.status) {
                case 'pending': pending++; break;
                case 'processing': processing++; break;
                case 'completed': completed++; break;
                case 'error': error++; break;
            }
        }

        return {
            total: this.jobs.size,
            maxJobs: this.maxJobs,
            pending,
            processing,
            completed,
            error
        };
    }
}

// Export singleton instance
module.exports = new JobManager();
