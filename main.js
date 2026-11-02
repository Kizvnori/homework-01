// Main Application Controller for osu! mania Web

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('game-canvas');
    const lobbyScreen = document.getElementById('lobby-screen');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    // Modals & Overlays
    const pauseOverlay = document.getElementById('pause-overlay');
    const resultsModal = document.getElementById('results-modal');
    const diffModal = document.getElementById('diff-modal');
    const diffList = document.getElementById('diff-list');
    const settingsModal = document.getElementById('settings-modal');

    // Buttons
    const btnPlay7k = document.getElementById('btn-play-7k');
    const btnPlay4k = document.getElementById('btn-play-4k');
    const btnBrowse = document.getElementById('btn-browse');
    const btnSettings = document.getElementById('btn-settings');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnCloseDiff = document.getElementById('btn-close-diff');

    const btnPauseResume = document.getElementById('btn-pause-resume');
    const btnPauseRetry = document.getElementById('btn-pause-retry');
    const btnPauseQuit = document.getElementById('btn-pause-quit');

    const btnResultRetry = document.getElementById('btn-result-retry');
    const btnResultMenu = document.getElementById('btn-result-menu');

    // Settings elements
    const setScrollSpeed = document.getElementById('setting-scroll-speed');
    const valScrollSpeed = document.getElementById('val-scroll-speed');
    const setBgDim = document.getElementById('setting-bg-dim');
    const valBgDim = document.getElementById('val-bg-dim');
    const setAudioOffset = document.getElementById('setting-audio-offset');
    const valAudioOffset = document.getElementById('val-audio-offset');
    const setMusicVol = document.getElementById('setting-music-vol');
    const valMusicVol = document.getElementById('val-music-vol');
    const setHitsoundVol = document.getElementById('setting-hitsound-vol');
    const valHitsoundVol = document.getElementById('val-hitsound-vol');

    // Instantiate core systems
    const audio = new AudioEngine();
    const game = new GameEngine(canvas, audio);
    const oszLoader = new OszLoader();

    let currentLoadedSong = null; // Stores currently loaded map & audio for retry

    // Connect Game Engine Callbacks
    window.onGamePauseToggle = (isPaused) => {
        if (isPaused) {
            pauseOverlay.classList.add('active');
        } else {
            pauseOverlay.classList.remove('active');
        }
    };

    window.onGameFinished = (results) => {
        // Populate results modal
        const gradeEl = document.getElementById('result-grade');
        gradeEl.className = `result-grade grade-${results.grade}`;
        gradeEl.textContent = results.grade;

        document.getElementById('result-score').textContent = results.score.toString().padStart(7, '0');
        document.getElementById('stat-acc').textContent = `${results.accuracy.toFixed(2)}%`;
        document.getElementById('stat-combo').textContent = `${results.maxCombo}x`;

        document.getElementById('stat-marvelous').textContent = results.hits.marvelous;
        document.getElementById('stat-perfect').textContent = results.hits.perfect;
        document.getElementById('stat-great').textContent = results.hits.great;
        document.getElementById('stat-good').textContent = results.hits.good;
        document.getElementById('stat-bad').textContent = results.hits.bad;
        document.getElementById('stat-miss').textContent = results.hits.miss;

        resultsModal.classList.add('active');
    };

    // Helper: Start Playing
    function startGame(beatmap, audioBlob, bgBlob = null) {
        currentLoadedSong = { beatmap, audioBlob, bgBlob };
        lobbyScreen.classList.add('hidden');
        pauseOverlay.classList.remove('active');
        resultsModal.classList.remove('active');
        diffModal.classList.remove('active');

        if (audioBlob) {
            audio.loadFromBlob(audioBlob).then(() => {
                game.loadBeatmap(beatmap, bgBlob);
                game.start();
            }).catch(err => {
                alert("Error loading audio: " + err.message);
            });
        } else {
            // Demo procedural audio
            audio.generateDemoSong();
            game.loadBeatmap(beatmap, bgBlob);
            game.start();
        }
    }

    // Helper: Return to Menu
    function returnToMenu() {
        game.stop();
        pauseOverlay.classList.remove('active');
        resultsModal.classList.remove('active');
        diffModal.classList.remove('active');
        lobbyScreen.classList.remove('hidden');
    }

    // --- Action Button Events ---
    btnPlay7k.addEventListener('click', () => {
        const demoBeatmap = OsuParser.createDemoBeatmap(7);
        startGame(demoBeatmap, null, null);
    });

    btnPlay4k.addEventListener('click', () => {
        const demoBeatmap = OsuParser.createDemoBeatmap(4);
        startGame(demoBeatmap, null, null);
    });

    btnBrowse.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('click', () => fileInput.click());

    // Pause Controls
    btnPauseResume.addEventListener('click', () => {
        game.resume();
        pauseOverlay.classList.remove('active');
    });

    btnPauseRetry.addEventListener('click', () => {
        if (currentLoadedSong) {
            startGame(currentLoadedSong.beatmap, currentLoadedSong.audioBlob, currentLoadedSong.bgBlob);
        }
    });

    btnPauseQuit.addEventListener('click', () => {
        returnToMenu();
    });

    // Results Controls
    btnResultRetry.addEventListener('click', () => {
        if (currentLoadedSong) {
            startGame(currentLoadedSong.beatmap, currentLoadedSong.audioBlob, currentLoadedSong.bgBlob);
        }
    });

    btnResultMenu.addEventListener('click', () => {
        returnToMenu();
    });

    // --- Drag & Drop Handling ---
    ['dragenter', 'dragover'].forEach(eventName => {
        window.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        window.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        });
    });

    window.addEventListener('drop', (e) => {
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            handleSelectedFiles(files);
        }
    });

    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            handleSelectedFiles(files);
        }
    });

    async function handleSelectedFiles(files) {
        // 1. Check for .osz package
        const oszFile = files.find(f => f.name.toLowerCase().endsWith('.osz') || f.name.toLowerCase().endsWith('.zip'));
        if (oszFile) {
            try {
                dropZone.querySelector('.dropzone-title').textContent = "Unpacking .osz beatmap...";
                const pkg = await oszLoader.loadOsz(oszFile);

                if (pkg.difficulties.length === 1) {
                    const diff = pkg.difficulties[0];
                    const audioBlob = await oszLoader.getAudioBlob(diff.parsed.general.AudioFilename);
                    const bgBlob = await oszLoader.getBackgroundImageBlob(diff.parsed.bgFilename);
                    startGame(diff.parsed, audioBlob, bgBlob);
                } else {
                    // Show difficulty picker
                    showDifficultyPicker(pkg);
                }
            } catch (err) {
                alert("Failed to load .osz: " + err.message);
            } finally {
                dropZone.querySelector('.dropzone-title').textContent = "Drop your .osz or .osu file here";
            }
            return;
        }

        // 2. Check for loose .osu + Audio files
        const osuFile = files.find(f => f.name.toLowerCase().endsWith('.osu'));
        const audioFile = files.find(f => {
            const l = f.name.toLowerCase();
            return l.endsWith('.mp3') || l.endsWith('.ogg') || l.endsWith('.wav');
        });

        if (osuFile) {
            const content = await osuFile.text();
            const parsed = OsuParser.parse(content);
            if (audioFile) {
                startGame(parsed, audioFile, null);
            } else {
                alert("Please drop the audio file (.mp3 / .ogg) together with the .osu file!");
            }
        }
    }

    function showDifficultyPicker(pkg) {
        diffList.innerHTML = '';
        pkg.difficulties.forEach(diff => {
            const item = document.createElement('div');
            item.className = 'diff-item';

            const keyCount = diff.parsed.difficulty.CircleSize || 4;
            const title = diff.parsed.metadata.Title || 'Unknown';
            const version = diff.parsed.metadata.Version || 'Normal';

            item.innerHTML = `
                <div>
                    <div class="diff-name">${version}</div>
                    <div class="diff-info">${title} • OD: ${diff.parsed.difficulty.OverallDifficulty || 8}</div>
                </div>
                <div class="diff-badge">${keyCount}K</div>
            `;

            item.addEventListener('click', async () => {
                diffModal.classList.remove('active');
                const audioBlob = await oszLoader.getAudioBlob(diff.parsed.general.AudioFilename);
                const bgBlob = await oszLoader.getBackgroundImageBlob(diff.parsed.bgFilename);
                startGame(diff.parsed, audioBlob, bgBlob);
            });

            diffList.appendChild(item);
        });

        diffModal.classList.add('active');
    }

    btnCloseDiff.addEventListener('click', () => {
        diffModal.classList.remove('active');
    });

    // --- Settings Modal & Sliders ---
    btnSettings.addEventListener('click', () => {
        settingsModal.classList.add('active');
    });

    btnCloseSettings.addEventListener('click', () => {
        settingsModal.classList.remove('active');
    });

    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('active');
        }
    });

    diffModal.addEventListener('click', (e) => {
        if (e.target === diffModal) {
            diffModal.classList.remove('active');
        }
    });

    // Scroll Speed
    setScrollSpeed.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        valScrollSpeed.textContent = val;
        game.scrollSpeed = val;
    });

    // Background Dim
    setBgDim.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        valBgDim.textContent = `${val}%`;
        game.bgDim = val / 100;
    });

    // Audio Offset
    setAudioOffset.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        valAudioOffset.textContent = `${val > 0 ? '+' : ''}${val} ms`;
        game.userOffsetMs = val;
    });

    // Music Volume
    setMusicVol.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        valMusicVol.textContent = `${val}%`;
        audio.setMusicVolume(val / 100);
    });

    // Hitsound Volume
    setHitsoundVol.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        valHitsoundVol.textContent = `${val}%`;
        audio.setHitsoundVolume(val / 100);
    });
});
