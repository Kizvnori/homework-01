// osu! mania Web Game Engine
// Canvas 60-144fps Renderer with Circular Skin & Reference Aesthetic

class GameEngine {
    constructor(canvas, audioEngine) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.audio = audioEngine;

        this.beatmap = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.startTime = 0;
        this.songFinished = false;

        // Settings
        this.scrollSpeed = 24; // Equivalent to osu! mania scroll speed
        this.bgDim = 0.65; // Background dim 0 to 1
        this.bgImage = null;
        this.userOffsetMs = 0;

        // Default Keybinds
        this.keybinds = {
            4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
            7: ['KeyS', 'KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK', 'KeyL']
        };

        // Input state
        this.keyState = {};
        this.keyLanesDown = {};

        // Play statistics
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.health = 100;
        this.hits = {
            marvelous: 0,
            perfect: 0,
            great: 0,
            good: 0,
            bad: 0,
            miss: 0
        };
        this.hitErrors = []; // For UR (Unstable Rate) bar

        // Visual effects
        this.hitParticles = [];
        this.judgementText = null;
        this.judgementTimer = 0;
        this.judgementType = '';

        // Bindings
        this.boundKeyDown = this.handleKeyDown.bind(this);
        this.boundKeyUp = this.handleKeyUp.bind(this);
        this.boundResize = this.resize.bind(this);
        this.boundCanvasClick = this.handleCanvasClick.bind(this);

        this.setupEvents();
        this.resize();
    }

    setupEvents() {
        window.addEventListener('keydown', this.boundKeyDown);
        window.addEventListener('keyup', this.boundKeyUp);
        window.addEventListener('resize', this.boundResize);
        this.canvas.addEventListener('click', this.boundCanvasClick);
    }

    handleCanvasClick(e) {
        if (!this.isPlaying) return;
        const rect = this.canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Check if clicked top-left pause button (x < 100, y < 80)
        if (clickX <= 100 && clickY <= 80) {
            if (this.isPaused) this.resume();
            else this.pause();
            if (window.onGamePauseToggle) window.onGamePauseToggle(this.isPaused);
        }
    }

    destroy() {
        window.removeEventListener('keydown', this.boundKeyDown);
        window.removeEventListener('keyup', this.boundKeyUp);
        window.removeEventListener('resize', this.boundResize);
        this.canvas.removeEventListener('click', this.boundCanvasClick);
        this.stop();
    }

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.floor(this.width * dpr);
        this.canvas.height = Math.floor(this.height * dpr);
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    loadBeatmap(beatmap, bgBlob = null) {
        this.beatmap = JSON.parse(JSON.stringify(beatmap)); // Clone
        this.keyCount = this.beatmap.difficulty.CircleSize || 4;

        // Reset gameplay state
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.health = 100;
        this.hits = { marvelous: 0, perfect: 0, great: 0, good: 0, bad: 0, miss: 0 };
        this.hitErrors = [];
        this.hitParticles = [];
        this.judgementText = null;
        this.songFinished = false;
        this.isPaused = false;

        // Reset hitobjects state
        this.beatmap.hitObjects.forEach(note => {
            note.hitState = 0;
            note.holdState = 0;
            note.tailHitState = 0;
        });

        // Set background if provided
        if (bgBlob) {
            const url = URL.createObjectURL(bgBlob);
            const img = new Image();
            img.onload = () => { this.bgImage = img; };
            img.src = url;
        } else {
            this.bgImage = null;
        }
    }

    start() {
        if (!this.beatmap) return;
        this.isPlaying = true;
        this.isPaused = false;
        this.songFinished = false;
        this.audio.play(0);
        requestAnimationFrame(this.loop.bind(this));
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPaused = true;
        this.audio.pause();
    }

    resume() {
        if (!this.isPlaying || !this.isPaused) return;
        this.isPaused = false;
        this.audio.play(this.audio.pauseOffset);
        requestAnimationFrame(this.loop.bind(this));
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        this.audio.stop();
    }

    getCurrentTimeMs() {
        return (this.audio.getCurrentTime() * 1000) + this.userOffsetMs;
    }

    getLaneKeys() {
        return this.keybinds[this.keyCount] || this.keybinds[4];
    }

    handleKeyDown(e) {
        if (e.repeat) return;
        if (e.code === 'Escape') {
            if (this.isPlaying) {
                if (this.isPaused) this.resume();
                else this.pause();
                if (window.onGamePauseToggle) window.onGamePauseToggle(this.isPaused);
            }
            return;
        }

        const keys = this.getLaneKeys();
        const lane = keys.indexOf(e.code);
        if (lane === -1 || !this.isPlaying || this.isPaused) return;

        this.keyLanesDown[lane] = true;
        this.judgeLanePress(lane);
    }

    handleKeyUp(e) {
        const keys = this.getLaneKeys();
        const lane = keys.indexOf(e.code);
        if (lane === -1) return;

        this.keyLanesDown[lane] = false;
        if (this.isPlaying && !this.isPaused) {
            this.judgeLaneRelease(lane);
        }
    }

    judgeLanePress(lane) {
        const currentTime = this.getCurrentTimeMs();
        const tw = this.beatmap.timingWindows;

        // Find candidate note in this lane
        let candidate = null;
        let minDiff = Infinity;

        for (const note of this.beatmap.hitObjects) {
            if (note.lane !== lane) continue;
            if (note.hitState !== 0) continue;

            const diff = note.time - currentTime;
            // Timing window check: diff within [-miss, +miss]
            if (Math.abs(diff) <= tw.miss) {
                if (Math.abs(diff) < minDiff) {
                    minDiff = Math.abs(diff);
                    candidate = note;
                }
            } else if (diff > tw.miss) {
                // Since notes are sorted by time, future notes exceed miss window
                break;
            }
        }

        if (candidate) {
            const rawDiff = currentTime - candidate.time;
            const absDiff = Math.abs(rawDiff);

            this.hitErrors.push(rawDiff);
            if (this.hitErrors.length > 50) this.hitErrors.shift();

            let judgement = 'miss';
            let scoreAdd = 0;
            let hpAdd = 0;

            if (absDiff <= tw.marvelous) {
                judgement = 'marvelous';
                scoreAdd = 320;
                hpAdd = 3;
            } else if (absDiff <= tw.perfect) {
                judgement = 'perfect';
                scoreAdd = 300;
                hpAdd = 2;
            } else if (absDiff <= tw.great) {
                judgement = 'great';
                scoreAdd = 200;
                hpAdd = 1;
            } else if (absDiff <= tw.good) {
                judgement = 'good';
                scoreAdd = 100;
                hpAdd = 0;
            } else if (absDiff <= tw.bad) {
                judgement = 'bad';
                scoreAdd = 50;
                hpAdd = -3;
            } else {
                judgement = 'miss';
                scoreAdd = 0;
                hpAdd = -6;
            }

            if (candidate.isHold) {
                candidate.hitState = 1; // Head hit
                candidate.holdState = 1; // Now holding
                candidate.headJudgement = judgement;
            } else {
                candidate.hitState = 1;
            }

            this.applyJudgement(judgement, scoreAdd, hpAdd);
            this.audio.playHitSound('normal');
            this.triggerHitEffect(lane);
        }
    }

    judgeLaneRelease(lane) {
        const currentTime = this.getCurrentTimeMs();
        const tw = this.beatmap.timingWindows;

        // Check if releasing a Long Note
        for (const note of this.beatmap.hitObjects) {
            if (note.lane !== lane) continue;
            if (note.isHold && note.holdState === 1) {
                note.holdState = 2; // Released
                const rawDiff = currentTime - note.endTime;
                const absDiff = Math.abs(rawDiff);

                let judgement = 'perfect';
                let scoreAdd = 300;
                let hpAdd = 2;

                if (absDiff <= tw.perfect) {
                    judgement = 'perfect';
                } else if (absDiff <= tw.great) {
                    judgement = 'great';
                    scoreAdd = 200;
                } else if (absDiff <= tw.good) {
                    judgement = 'good';
                    scoreAdd = 100;
                } else if (rawDiff < -tw.good) {
                    // Released way too early
                    judgement = 'miss';
                    scoreAdd = 0;
                    hpAdd = -5;
                }

                note.tailHitState = judgement === 'miss' ? 2 : 1;
                this.applyJudgement(judgement, scoreAdd, hpAdd);
                if (judgement !== 'miss') {
                    this.audio.playHitSound('normal');
                    this.triggerHitEffect(lane);
                }
                break;
            }
        }
    }

    applyJudgement(type, scoreAdd, hpAdd) {
        this.hits[type]++;
        this.judgementType = type;
        this.judgementTimer = 1.0;

        if (type === 'miss') {
            this.combo = 0;
            this.health = Math.max(0, this.health + hpAdd);
        } else {
            this.combo++;
            if (this.combo > this.maxCombo) this.maxCombo = this.combo;
            this.health = Math.min(100, this.health + hpAdd);

            // osu! mania score scaling
            const comboMultiplier = Math.min(1 + this.combo * 0.001, 1.5);
            this.score += Math.round(scoreAdd * comboMultiplier);
        }
    }

    triggerHitEffect(lane) {
        this.hitParticles.push({
            lane,
            life: 1.0,
            scale: 1.0
        });
    }

    checkMisses(currentTime) {
        const tw = this.beatmap.timingWindows;

        for (const note of this.beatmap.hitObjects) {
            if (note.hitState === 0) {
                if (currentTime - note.time > tw.miss) {
                    note.hitState = 2; // Missed
                    if (note.isHold) note.holdState = 3;
                    this.applyJudgement('miss', 0, -6);
                }
            } else if (note.isHold && note.holdState === 1) {
                // Still holding past endTime? Auto-complete tail as perfect
                if (currentTime >= note.endTime) {
                    note.holdState = 2;
                    note.tailHitState = 1;
                    this.applyJudgement('perfect', 300, 2);
                    this.triggerHitEffect(note.lane);
                }
            }
        }
    }

    calculateAccuracy() {
        const totalNotes = this.hits.marvelous + this.hits.perfect + this.hits.great +
                           this.hits.good + this.hits.bad + this.hits.miss;
        if (totalNotes === 0) return 100.00;

        const points = (this.hits.marvelous * 300) +
                       (this.hits.perfect * 300) +
                       (this.hits.great * 200) +
                       (this.hits.good * 100) +
                       (this.hits.bad * 50);

        const maxPoints = totalNotes * 300;
        return ((points / maxPoints) * 100);
    }

    getGrade(acc) {
        if (this.hits.miss === 0 && acc >= 99.5) return 'SS';
        if (acc >= 95) return 'S';
        if (acc >= 90) return 'A';
        if (acc >= 80) return 'B';
        if (acc >= 70) return 'C';
        return 'D';
    }

    // Main Game Render Loop
    loop() {
        if (!this.isPlaying || this.isPaused) return;

        const currentTime = this.getCurrentTimeMs();
        this.checkMisses(currentTime);

        this.render(currentTime);

        // Check if beatmap finished
        const lastNote = this.beatmap.hitObjects[this.beatmap.hitObjects.length - 1];
        const lastTime = lastNote ? Math.max(lastNote.time, lastNote.endTime) : 0;
        if (currentTime > lastTime + 2000 && !this.songFinished) {
            this.songFinished = true;
            if (window.onGameFinished) {
                window.onGameFinished({
                    score: this.score,
                    maxCombo: this.maxCombo,
                    accuracy: this.calculateAccuracy(),
                    grade: this.getGrade(this.calculateAccuracy()),
                    hits: this.hits
                });
            }
            return;
        }

        requestAnimationFrame(this.loop.bind(this));
    }

    render(currentTime) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);

        // 1. Draw Background Image with Dim
        if (this.bgImage) {
            const imgRatio = this.bgImage.width / this.bgImage.height;
            const screenRatio = w / h;
            let drawW, drawH, drawX, drawY;

            if (screenRatio > imgRatio) {
                drawW = w;
                drawH = w / imgRatio;
                drawX = 0;
                drawY = (h - drawH) / 2;
            } else {
                drawH = h;
                drawW = h * imgRatio;
                drawX = (w - drawW) / 2;
                drawY = 0;
            }
            ctx.drawImage(this.bgImage, drawX, drawY, drawW, drawH);
        } else {
            // Gradient background resembling screenshot
            const grad = ctx.createLinearGradient(0, 0, w, h);
            grad.addColorStop(0, '#100a20');
            grad.addColorStop(0.5, '#1e1035');
            grad.addColorStop(1, '#080812');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
        }

        // Apply Background Dim
        ctx.fillStyle = `rgba(0, 0, 0, ${this.bgDim})`;
        ctx.fillRect(0, 0, w, h);

        // 2. Playfield Geometry
        const keyCount = this.keyCount;
        // Lane width and note radius
        const maxPlayfieldWidth = Math.min(w * 0.85, keyCount * 90);
        const laneWidth = maxPlayfieldWidth / keyCount;
        const playfieldX = (w - maxPlayfieldWidth) / 2;
        const noteRadius = laneWidth * 0.42;

        const targetY = h * 0.88; // Receptor position near bottom
        const spawnY = -noteRadius * 2;
        const scrollDist = targetY - spawnY;
        // Travel duration based on scrollSpeed (higher speed = less time on screen)
        const travelDuration = (2800 / this.scrollSpeed) * 10; // ms

        // Soft playfield backdrop glow
        ctx.fillStyle = 'rgba(15, 15, 25, 0.4)';
        ctx.fillRect(playfieldX - 10, 0, maxPlayfieldWidth + 20, h);

        // 3. Draw Lane Keypress Light Beams
        for (let i = 0; i < keyCount; i++) {
            if (this.keyLanesDown[i]) {
                const laneCenterX = playfieldX + i * laneWidth + laneWidth / 2;
                const beamGrad = ctx.createLinearGradient(0, targetY, 0, 0);
                beamGrad.addColorStop(0, 'rgba(140, 190, 255, 0.28)');
                beamGrad.addColorStop(0.4, 'rgba(100, 160, 255, 0.12)');
                beamGrad.addColorStop(1, 'rgba(60, 120, 255, 0.0)');
                ctx.fillStyle = beamGrad;
                ctx.fillRect(playfieldX + i * laneWidth, 0, laneWidth, targetY);
            }
        }

        // 4. Draw Hit Objects (Long Note bodies first, then heads and taps)
        const visibleMinTime = currentTime - 200;
        const visibleMaxTime = currentTime + travelDuration + 100;

        for (const note of this.beatmap.hitObjects) {
            const noteEndTime = note.isHold ? note.endTime : note.time;
            if (noteEndTime < visibleMinTime) continue;
            if (note.time > visibleMaxTime) continue;

            const laneCenterX = playfieldX + note.lane * laneWidth + laneWidth / 2;

            // Long Note Body
            if (note.isHold) {
                const headY = targetY - ((note.time - currentTime) / travelDuration) * scrollDist;
                const tailY = targetY - ((note.endTime - currentTime) / travelDuration) * scrollDist;

                // Clamp head if currently holding
                const currentHeadY = note.holdState === 1 ? targetY : headY;

                if (tailY < targetY && currentHeadY > 0) {
                    ctx.save();
                    const isCenterLane = (keyCount === 7 && note.lane === 3);
                    const bodyColor = isCenterLane ? 'rgba(90, 90, 95, 0.65)' : 'rgba(110, 170, 240, 0.55)';
                    const strokeColor = isCenterLane ? '#999999' : '#b0d6ff';

                    ctx.fillStyle = bodyColor;
                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = 3;

                    const bodyWidth = noteRadius * 1.6;
                    const bx = laneCenterX - bodyWidth / 2;
                    const by = tailY;
                    const bh = Math.max(4, currentHeadY - tailY);

                    // Rounded Capsule Body
                    ctx.beginPath();
                    const r = bodyWidth / 2;
                    if (ctx.roundRect) {
                        ctx.roundRect(bx, by, bodyWidth, bh, [r, r, r, r]);
                    } else {
                        ctx.rect(bx, by, bodyWidth, bh);
                    }
                    ctx.fill();
                    ctx.stroke();

                    ctx.restore();
                }
            }

            // Note Head / Tap Circle
            if (note.hitState === 0 || (note.isHold && note.holdState === 1 && note.endTime > currentTime)) {
                let noteY = targetY - ((note.time - currentTime) / travelDuration) * scrollDist;
                if (note.isHold && note.holdState === 1) {
                    noteY = targetY; // Held at receptor
                }

                if (noteY >= -noteRadius && noteY <= h + noteRadius) {
                    this.drawNoteCircle(ctx, laneCenterX, noteY, noteRadius, note.lane, keyCount);
                }
            }
        }

        // 5. Draw Circular Hit Receptors (Bottom Circles matching reference image)
        for (let i = 0; i < keyCount; i++) {
            const rx = playfieldX + i * laneWidth + laneWidth / 2;
            const isPressed = this.keyLanesDown[i];
            const isCenterLane = (keyCount === 7 && i === 3);

            ctx.save();
            ctx.beginPath();
            ctx.arc(rx, targetY, noteRadius, 0, Math.PI * 2);

            if (isPressed) {
                // Bright pressed state
                ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 5;
                ctx.shadowColor = '#80c0ff';
                ctx.shadowBlur = 18;
                ctx.stroke();
            } else {
                // Idle state: Clean glowing white ring matching screenshot
                ctx.fillStyle = 'rgba(20, 20, 35, 0.3)';
                ctx.fill();
                ctx.strokeStyle = isCenterLane ? 'rgba(200, 200, 200, 0.85)' : 'rgba(255, 255, 255, 0.9)';
                ctx.lineWidth = 4;
                ctx.shadowColor = 'rgba(100, 150, 255, 0.4)';
                ctx.shadowBlur = 8;
                ctx.stroke();
            }
            ctx.restore();
        }

        // 6. Draw Hit Particles / Ripple Waves
        for (let p = this.hitParticles.length - 1; p >= 0; p--) {
            const pt = this.hitParticles[p];
            const px = playfieldX + pt.lane * laneWidth + laneWidth / 2;
            pt.life -= 0.05;
            pt.scale += 0.08;

            if (pt.life <= 0) {
                this.hitParticles.splice(p, 1);
                continue;
            }

            ctx.save();
            ctx.beginPath();
            ctx.arc(px, targetY, noteRadius * pt.scale, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${pt.life * 0.7})`;
            ctx.lineWidth = 3 * pt.life;
            ctx.shadowColor = '#70b0ff';
            ctx.shadowBlur = 12;
            ctx.stroke();
            ctx.restore();
        }

        // 7. Draw Floating Judgement ("PERFECT", "GREAT", etc.)
        if (this.judgementTimer > 0) {
            this.judgementTimer -= 0.025;
            ctx.save();
            ctx.font = 'bold 28px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const colors = {
                marvelous: '#70e0ff',
                perfect: '#ffd700',
                great: '#70ff90',
                good: '#60a0ff',
                bad: '#d080ff',
                miss: '#ff5050'
            };

            const labels = {
                marvelous: 'PERFECT',
                perfect: 'PERFECT',
                great: 'GREAT',
                good: 'GOOD',
                bad: 'BAD',
                miss: 'MISS'
            };

            const jColor = colors[this.judgementType] || '#fff';
            const jLabel = labels[this.judgementType] || '';
            const jy = targetY - noteRadius - 80 - (1 - this.judgementTimer) * 15;

            ctx.fillStyle = jColor;
            ctx.shadowColor = jColor;
            ctx.shadowBlur = 15;
            ctx.globalAlpha = Math.min(1, this.judgementTimer * 1.5);
            ctx.fillText(jLabel, w / 2, jy);
            ctx.restore();
        }

        // 8. Draw HUD Elements matching the Reference Image
        this.renderHUD(ctx, w, h);
    }

    // Draw circular note matching reference image colors
    drawNoteCircle(ctx, x, y, r, lane, keyCount) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);

        const isCenterLane = (keyCount === 7 && lane === 3);

        if (isCenterLane) {
            // Dark charcoal circle with soft ring for center lane (Lane 4)
            const grad = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
            grad.addColorStop(0, '#505055');
            grad.addColorStop(0.85, '#353538');
            grad.addColorStop(1, '#252528');
            ctx.fillStyle = grad;
            ctx.fill();

            ctx.strokeStyle = 'rgba(190, 190, 200, 0.75)';
            ctx.lineWidth = 3.5;
            ctx.stroke();
        } else {
            // Pastel Blue/Cyan circle with crisp white outline for outer lanes
            const grad = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
            grad.addColorStop(0, '#86bfe3');
            grad.addColorStop(0.7, '#6b9dc2');
            grad.addColorStop(1, '#5382a5');
            ctx.fillStyle = grad;
            ctx.fill();

            // White crisp outer border
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.shadowColor = 'rgba(120, 180, 255, 0.5)';
            ctx.shadowBlur = 8;
            ctx.stroke();
        }

        ctx.restore();
    }

    renderHUD(ctx, w, h) {
        ctx.save();

        // --- TOP-LEFT: Score and Pause ---
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.font = '600 32px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Pause icon (||)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = '22px Inter, system-ui, sans-serif';
        ctx.fillText('⏸', 36, 42);

        // Score format: e.g. 225,641
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 32px Inter, system-ui, sans-serif';
        const formattedScore = this.score.toString().padStart(6, '0');
        ctx.fillText(formattedScore, 70, 42);

        // --- TOP-RIGHT: Grade, PP, Health Slanted Ticks, Combo, Stats, BPM, Acc ---
        const rightMargin = w - 40;
        ctx.textAlign = 'right';

        // Accuracy
        const accVal = this.calculateAccuracy();
        ctx.font = '700 17px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillText(`${accVal.toFixed(2)} %`, rightMargin - 140, 75);

        // BPM Counter
        const bpm = (this.beatmap.timingPoints[0] && this.beatmap.timingPoints[0].bpm) || 165;
        ctx.font = '600 15px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.fillText(`${bpm} BPM`, rightMargin - 230, 75);

        // Judgement Hit Counts Row (26  37  31  37  40  37  24)
        ctx.font = '500 12px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        const countText = `${this.hits.marvelous}   ${this.hits.perfect}   ${this.hits.great}   ${this.hits.good}   ${this.hits.bad}   ${this.hits.miss}`;
        ctx.fillText(countText, rightMargin - 280, 85);

        // Grade Badge (e.g. SS in bright pink/purple)
        const grade = this.getGrade(accVal);
        ctx.font = '900 28px Inter, system-ui, sans-serif';
        ctx.fillStyle = grade.startsWith('S') ? '#f375c8' : '#70e0ff';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.fillText(grade, rightMargin - 200, 40);
        ctx.shadowBlur = 0;

        // Estimated PP (Rating)
        const pp = Math.floor((this.score / 1000000) * 120 * (accVal / 100));
        ctx.font = '600 17px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillText(`${pp} pp`, rightMargin - 150, 40);

        // Slanted Health Bar Ticks (\\ \\ \\ \\ \\)
        const totalTicks = 12;
        const activeTicks = Math.round((this.health / 100) * totalTicks);
        const tickStartX = rightMargin - 130;
        const tickY = 32;

        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        for (let t = 0; t < totalTicks; t++) {
            const tx = tickStartX + t * 9;
            ctx.beginPath();
            ctx.moveTo(tx, tickY + 14);
            ctx.lineTo(tx + 5, tickY);

            if (t < activeTicks) {
                ctx.strokeStyle = '#6fe0ff';
                ctx.shadowColor = '#40c0ff';
                ctx.shadowBlur = 6;
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.shadowBlur = 0;
            }
            ctx.stroke();
        }
        ctx.shadowBlur = 0;

        // Combo Counter (e.g. 281x)
        if (this.combo > 0) {
            ctx.font = '800 38px Inter, system-ui, sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(`${this.combo}x`, rightMargin, 48);
        }

        // --- BOTTOM-LEFT: Beatmap Title & Metadata ---
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.font = '700 20px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#ffffff';

        const artist = this.beatmap.metadata.Artist || 'Artist';
        const title = this.beatmap.metadata.Title || 'Title';
        const version = this.beatmap.metadata.Version || '';

        ctx.fillText(artist, 40, h - 45);

        ctx.font = '400 14px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.fillText(`${title} [ ${version} ]`, 40, h - 25);

        // --- BOTTOM-RIGHT: Hit Error (UR) Bar ---
        const urW = 200;
        const urH = 5;
        const urX = rightMargin - urW;
        const urY = h - 35;

        // UR Base Track
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(urX, urY, urW, urH);

        // Center line
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(urX + urW / 2 - 1, urY - 4, 2, urH + 8);

        // Colored zones: perfect zone (green)
        ctx.fillStyle = 'rgba(80, 230, 120, 0.5)';
        const maxRange = 140; // ms
        const perfectW = (this.beatmap.timingWindows.perfect / maxRange) * (urW / 2);
        ctx.fillRect(urX + urW / 2 - perfectW, urY, perfectW * 2, urH);

        // Recent Hit Error Ticks
        for (let err of this.hitErrors) {
            const clamped = Math.max(-maxRange, Math.min(maxRange, err));
            const tickX = urX + urW / 2 + (clamped / maxRange) * (urW / 2);
            ctx.fillStyle = err < 0 ? '#64b5f6' : '#ff7043'; // Blue = Early, Orange = Late
            ctx.fillRect(tickX - 1, urY - 3, 2, urH + 6);
        }

        ctx.restore();
    }
}

window.GameEngine = GameEngine;
