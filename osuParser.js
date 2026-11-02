// Osu Parser & Beatmap Handler
// Parses .osu format for osu! mania (both 4K and 7K and any key mode)

class OsuParser {
    static parse(content) {
        const lines = content.split(/\r?\n/);
        const beatmap = {
            general: {},
            metadata: {
                Title: "Unknown Title",
                Artist: "Unknown Artist",
                Creator: "Unknown Creator",
                Version: "Normal"
            },
            difficulty: {
                CircleSize: 4, // Key count
                OverallDifficulty: 8,
                ApproachRate: 5,
                SliderMultiplier: 1.4
            },
            timingPoints: [],
            hitObjects: [],
            bgFilename: null
        };

        let currentSection = '';

        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('//')) continue;

            if (line.startsWith('[') && line.endsWith(']')) {
                currentSection = line.substring(1, line.length - 1);
                continue;
            }

            switch (currentSection) {
                case 'General':
                    this.parseKeyValue(line, beatmap.general);
                    break;
                case 'Metadata':
                    this.parseKeyValue(line, beatmap.metadata);
                    break;
                case 'Difficulty':
                    this.parseKeyValue(line, beatmap.difficulty);
                    break;
                case 'Events':
                    // Look for background image: 0,0,"bg.jpg",0,0
                    if (line.startsWith('0,0,') || line.startsWith('Video,') === false) {
                        const parts = line.split(',');
                        if (parts.length >= 3 && parts[0] === '0') {
                            let filename = parts[2].replace(/"/g, '').trim();
                            if (filename && !beatmap.bgFilename) {
                                beatmap.bgFilename = filename;
                            }
                        }
                    }
                    break;
                case 'TimingPoints':
                    const tpParts = line.split(',');
                    if (tpParts.length >= 2) {
                        const time = parseFloat(tpParts[0]);
                        const beatLength = parseFloat(tpParts[1]);
                        const uninherited = tpParts.length > 6 ? parseInt(tpParts[6]) === 1 : (beatLength > 0);
                        beatmap.timingPoints.push({
                            time,
                            beatLength,
                            uninherited,
                            bpm: uninherited && beatLength > 0 ? Math.round(60000 / beatLength) : null
                        });
                    }
                    break;
                case 'HitObjects':
                    const hoParts = line.split(',');
                    if (hoParts.length >= 4) {
                        const x = parseInt(hoParts[0]);
                        const y = parseInt(hoParts[1]);
                        const time = parseInt(hoParts[2]);
                        const type = parseInt(hoParts[3]);
                        const hitSound = parseInt(hoParts[4]) || 0;

                        const keyCount = Math.max(1, Math.floor(parseFloat(beatmap.difficulty.CircleSize) || 4));
                        const lane = Math.min(keyCount - 1, Math.max(0, Math.floor((x * keyCount) / 512)));

                        const isHold = (type & 128) !== 0;
                        let endTime = time;
                        if (isHold && hoParts.length >= 6) {
                            endTime = parseInt(hoParts[5].split(':')[0]) || time;
                        }

                        beatmap.hitObjects.push({
                            lane,
                            time,
                            endTime: Math.max(time, endTime),
                            isHold,
                            hitSound,
                            // state flags for gameplay
                            hitState: 0, // 0 = unhit, 1 = hit, 2 = missed
                            holdState: 0, // for LN: 0 = unhit, 1 = holding, 2 = released, 3 = missed
                            tailHitState: 0
                        });
                    }
                    break;
            }
        }

        // Sort hit objects by start time
        beatmap.hitObjects.sort((a, b) => a.time - b.time);

        // Normalize CircleSize to integer
        beatmap.difficulty.CircleSize = Math.max(1, Math.floor(parseFloat(beatmap.difficulty.CircleSize) || 4));
        beatmap.difficulty.OverallDifficulty = parseFloat(beatmap.difficulty.OverallDifficulty) || 8;

        // Calculate timing windows from OverallDifficulty (OD)
        beatmap.timingWindows = this.calculateTimingWindows(beatmap.difficulty.OverallDifficulty);

        return beatmap;
    }

    static parseKeyValue(line, obj) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
            const key = line.substring(0, colonIdx).trim();
            const val = line.substring(colonIdx + 1).trim();
            obj[key] = val;
        }
    }

    static calculateTimingWindows(od) {
        // Standard osu! mania timing windows in milliseconds
        return {
            marvelous: 16,
            perfect: Math.floor(64 - 3 * od), // ~40ms at OD 8
            great: Math.floor(97 - 3 * od),   // ~73ms
            good: Math.floor(127 - 3 * od),   // ~103ms
            bad: Math.floor(151 - 3 * od),    // ~127ms
            miss: Math.floor(188 - 3 * od)    // ~164ms
        };
    }

    // Generate built-in 7K Beatmap matching our 165 BPM Demo Song
    static createDemoBeatmap(keyCount = 7) {
        const bpm = 165;
        const beatMs = 60000 / bpm; // ~363.63ms
        const halfBeat = beatMs / 2;
        const quarterBeat = beatMs / 4;

        const hitObjects = [];

        // Intro: Measures 2 to 4 (Start around 3s)
        const startMeasure = 2;
        const endMeasure = 30;

        for (let m = startMeasure; m < endMeasure; m++) {
            const measureStart = m * 4 * beatMs;

            if (m < 4) {
                // Intro single taps
                for (let b = 0; b < 4; b++) {
                    const time = Math.round(measureStart + b * beatMs);
                    const lane = (b * 2) % keyCount;
                    hitObjects.push({ lane, time, endTime: time, isHold: false });
                }
            } else if (m < 8) {
                // 8th note rhythm with alternate hands
                for (let h = 0; h < 8; h++) {
                    const time = Math.round(measureStart + h * halfBeat);
                    let lane;
                    if (keyCount === 7) {
                        lane = [0, 6, 1, 5, 2, 4, 3, 3][h];
                    } else {
                        lane = [0, 3, 1, 2, 0, 3, 1, 2][h];
                    }
                    hitObjects.push({ lane, time, endTime: time, isHold: false });
                }
            } else if (m < 16) {
                // Melodic section with Long Notes (Hold notes)
                const holdLane = keyCount === 7 ? 3 : 1; // Center lane hold
                hitObjects.push({
                    lane: holdLane,
                    time: Math.round(measureStart),
                    endTime: Math.round(measureStart + beatMs * 2),
                    isHold: true
                });

                // Taps around the hold note
                for (let b = 0; b < 4; b++) {
                    const time = Math.round(measureStart + b * beatMs);
                    if (keyCount === 7) {
                        const sideLane = b % 2 === 0 ? (b === 0 ? 0 : 2) : (b === 1 ? 6 : 4);
                        hitObjects.push({ lane: sideLane, time, endTime: time, isHold: false });
                    } else {
                        const sideLane = (b % 2 === 0) ? 0 : 3;
                        hitObjects.push({ lane: sideLane, time, endTime: time, isHold: false });
                    }
                }
            } else if (m < 24) {
                // Climax: streams & fast chords
                for (let h = 0; h < 8; h++) {
                    const time = Math.round(measureStart + h * halfBeat);
                    if (h % 4 === 0) {
                        // Double note
                        hitObjects.push({ lane: 0, time, endTime: time, isHold: false });
                        hitObjects.push({ lane: keyCount - 1, time, endTime: time, isHold: false });
                    } else {
                        const lane = (h * 3 + (keyCount === 7 ? 1 : 0)) % keyCount;
                        hitObjects.push({ lane, time, endTime: time, isHold: false });
                    }
                }
            } else {
                // Outro resolves with sustained chord notes
                for (let i = 0; i < (keyCount === 7 ? 3 : 2); i++) {
                    const lane = keyCount === 7 ? [1, 3, 5][i] : [1, 2][i];
                    hitObjects.push({
                        lane,
                        time: Math.round(measureStart),
                        endTime: Math.round(measureStart + beatMs * 3),
                        isHold: true
                    });
                }
            }
        }

        return {
            general: { AudioFilename: "demo.wav" },
            metadata: {
                Title: "Surrender (ft. Foux)",
                Artist: "Graveyard [Hixxy Remix]",
                Creator: "lost",
                Version: keyCount === 7 ? "7K [Exceed]" : "4K [Insane]"
            },
            difficulty: {
                CircleSize: keyCount,
                OverallDifficulty: 8,
                ApproachRate: 8,
                SliderMultiplier: 1.4
            },
            timingPoints: [
                { time: 0, beatLength: beatMs, uninherited: true, bpm: 165 }
            ],
            hitObjects,
            timingWindows: this.calculateTimingWindows(8),
            bgFilename: null
        };
    }
}

window.OsuParser = OsuParser;
