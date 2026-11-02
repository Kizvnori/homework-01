// OSZ & File Loader
// Handles unpacking .osz zip packages and reading individual .osu / audio files

class OszLoader {
    constructor() {
        this.zip = null;
        this.packageData = null;
    }

    // Process a .osz file (ZIP format)
    async loadOsz(file) {
        if (!window.JSZip) {
            throw new Error("JSZip library not loaded");
        }

        const zip = await window.JSZip.loadAsync(file);
        const osuFiles = [];
        const audioFiles = [];
        const imageFiles = [];

        // Scan entries
        for (const [filename, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            const lower = filename.toLowerCase();
            if (lower.endsWith('.osu')) {
                osuFiles.push(zipEntry);
            } else if (lower.endsWith('.mp3') || lower.endsWith('.ogg') || lower.endsWith('.wav')) {
                audioFiles.push(zipEntry);
            } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')) {
                imageFiles.push(zipEntry);
            }
        }

        if (osuFiles.length === 0) {
            throw new Error("No .osu files found in the .osz package!");
        }

        // Parse all beatmaps
        const difficulties = [];
        for (const osuEntry of osuFiles) {
            const content = await osuEntry.async("string");
            const parsed = OsuParser.parse(content);
            difficulties.push({
                entry: osuEntry,
                filename: osuEntry.name,
                parsed: parsed
            });
        }

        // Sort difficulties by CS (key count) or star/OD
        difficulties.sort((a, b) => (b.parsed.difficulty.CircleSize || 4) - (a.parsed.difficulty.CircleSize || 4));

        this.packageData = {
            zip,
            difficulties,
            audioFiles,
            imageFiles
        };

        return this.packageData;
    }

    async getAudioBlob(audioFilename) {
        if (!this.packageData) return null;
        const normalized = (audioFilename || '').trim().toLowerCase();

        // Exact match or fallback to any audio
        let target = this.packageData.audioFiles.find(f => f.name.toLowerCase() === normalized);
        if (!target && this.packageData.audioFiles.length > 0) {
            target = this.packageData.audioFiles[0];
        }

        if (target) {
            return await target.async("blob");
        }
        return null;
    }

    async getBackgroundImageBlob(bgFilename) {
        if (!this.packageData) return null;
        const normalized = (bgFilename || '').trim().toLowerCase();

        let target = this.packageData.imageFiles.find(f => f.name.toLowerCase() === normalized);
        if (!target && this.packageData.imageFiles.length > 0) {
            target = this.packageData.imageFiles[0];
        }

        if (target) {
            return await target.async("blob");
        }
        return null;
    }
}

window.OszLoader = OszLoader;
