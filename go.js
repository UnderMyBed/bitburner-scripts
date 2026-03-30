/**
 * IPvGO player using Monte Carlo Tree Search (MCTS).
 *
 * Original pattern-matching version by: Sphyxis, Stoneware, gmcew, eithel, Insight (alainbryden)
 * MCTS rewrite by: UnderMyBed
 */

import {
    getConfiguration, instanceCount, log, getErrorInfo, getActiveSourceFiles, getNsDataThroughFile
} from './helpers.js'

const argsSchema = [
    ['cheats', true], // Use cheats if BN14.2+ available
    ['disable-cheats', false], // Disable cheats
    ['cheat-chance-threshold', 0.9], // Don't cheat if success chance below this
    ['mcts-time-ms', 200], // Time budget per move for MCTS (milliseconds). Keep low to avoid lagging the game.
    ['mcts-time-ms-endgame', 100], // Reduced time budget when few empty spaces remain
    ['runOnce', false], // Play one game then exit
    ['board-size', 13], // Board size for new games
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns */
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || (await instanceCount(ns)) > 1) return;
    ns.disableLog("ALL");

    const sourceFiles = await getActiveSourceFiles(ns, true);
    const cheats = !runOptions['disable-cheats'] && (sourceFiles[14] ?? 0) >= 2;
    const cheatThreshold = runOptions['cheat-chance-threshold'];
    const mctsTime = runOptions['mcts-time-ms'];
    const mctsTimeEndgame = runOptions['mcts-time-ms-endgame'];
    const boardSize = runOptions['board-size'];
    const runOnce = runOptions['runOnce'];

    const opponents = ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati"];
    const opponentsWithMystery = [...opponents, "????????????"];

    // RAM-dodging wrappers for analysis functions (called once per turn, not in the hot loop)
    async function getBoardState() { return await getNsDataThroughFile(ns, `ns.go.getBoardState()`); }
    async function getValidMoves() { return await getNsDataThroughFile(ns, `ns.go.analysis.getValidMoves()`); }
    async function getCheatChance() { return await getNsDataThroughFile(ns, `ns.go.cheat.getCheatSuccessChance()`); }
    async function cheatPlayTwo(x1, y1, x2, y2) {
        return await getNsDataThroughFile(ns, `await ns.go.cheat.playTwoMoves(...ns.args)`, null, [x1, y1, x2, y2]);
    }

    // ==================== MCTS GO ENGINE (pure JS, no NS calls) ====================

    const EMPTY = '.', BLACK = 'X', WHITE = 'O', WALL = '#';

    /** Clone a board state (array of strings → array of arrays for mutability) */
    function cloneBoard(board) { return board.map(row => [...row]); }

    /** Get the character at (x, y), or WALL if out of bounds */
    function getCell(board, x, y) {
        if (x < 0 || y < 0 || x >= board.length || y >= board[0].length) return WALL;
        return board[x][y];
    }

    /** Find all stones in the same group as (x, y) and count their liberties */
    function getGroup(board, x, y) {
        const color = board[x][y];
        if (color === EMPTY || color === WALL) return { stones: [], liberties: 0 };
        const visited = new Set();
        const stones = [];
        let liberties = 0;
        const stack = [[x, y]];
        while (stack.length > 0) {
            const [cx, cy] = stack.pop();
            const key = cx * 100 + cy;
            if (visited.has(key)) continue;
            visited.add(key);
            const cell = getCell(board, cx, cy);
            if (cell === EMPTY) { liberties++; continue; }
            if (cell !== color) continue;
            stones.push([cx, cy]);
            stack.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
        }
        return { stones, liberties };
    }

    /** Remove captured stones (groups with 0 liberties) adjacent to (x, y) of the given color */
    function removeCaptures(board, x, y, capturedColor) {
        let captured = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (getCell(board, nx, ny) === capturedColor) {
                const group = getGroup(board, nx, ny);
                if (group.liberties === 0) {
                    for (const [sx, sy] of group.stones) board[sx][sy] = EMPTY;
                    captured += group.stones.length;
                }
            }
        }
        return captured;
    }

    /** Try to place a stone. Returns the new board if valid, null if invalid (self-capture or ko). */
    function tryMove(board, x, y, color, lastBoard) {
        if (getCell(board, x, y) !== EMPTY) return null;
        const newBoard = cloneBoard(board);
        newBoard[x][y] = color;
        const opponent = color === BLACK ? WHITE : BLACK;
        removeCaptures(newBoard, x, y, opponent);
        // Check self-capture
        const myGroup = getGroup(newBoard, x, y);
        if (myGroup.liberties === 0) return null;
        // Simple ko check: board can't return to previous state
        if (lastBoard && boardsEqual(newBoard, lastBoard)) return null;
        return newBoard;
    }

    function boardsEqual(a, b) {
        for (let x = 0; x < a.length; x++)
            for (let y = 0; y < a[0].length; y++)
                if (a[x][y] !== b[x][y]) return false;
        return true;
    }

    /** Get all valid moves for the given color on a simulated board */
    function getSimValidMoves(board, color, lastBoard) {
        const moves = [];
        for (let x = 0; x < board.length; x++)
            for (let y = 0; y < board[0].length; y++)
                if (board[x][y] === EMPTY && tryMove(board, x, y, color, lastBoard) !== null)
                    moves.push([x, y]);
        return moves;
    }

    /** Score a board position using area scoring (Chinese rules): stones + controlled territory */
    function scoreBoard(board) {
        const size = board.length;
        let blackScore = 0, whiteScore = 0;
        const visited = Array.from({ length: size }, () => new Array(size).fill(false));

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                if (board[x][y] === BLACK) { blackScore++; continue; }
                if (board[x][y] === WHITE) { whiteScore++; continue; }
                if (board[x][y] === WALL || visited[x][y]) continue;
                // Flood-fill empty region to determine who controls it
                const region = [];
                let touchesBlack = false, touchesWhite = false;
                const stack = [[x, y]];
                while (stack.length > 0) {
                    const [cx, cy] = stack.pop();
                    if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
                    if (visited[cx][cy]) continue;
                    const cell = board[cx][cy];
                    if (cell === WALL) continue;
                    if (cell === BLACK) { touchesBlack = true; continue; }
                    if (cell === WHITE) { touchesWhite = true; continue; }
                    visited[cx][cy] = true;
                    region.push([cx, cy]);
                    stack.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
                }
                // Territory belongs to a player only if the region touches exactly one color
                if (touchesBlack && !touchesWhite) blackScore += region.length;
                else if (touchesWhite && !touchesBlack) whiteScore += region.length;
            }
        }
        return { black: blackScore, white: whiteScore };
    }

    /** Run a random playout from the given position until both players pass or board is full */
    function randomPlayout(board, currentColor, lastBoard) {
        let b = cloneBoard(board);
        let color = currentColor;
        let prevBoard = lastBoard ? cloneBoard(lastBoard) : null;
        let consecutivePasses = 0;
        const maxMoves = board.length * board[0].length * 2; // Safety limit

        for (let i = 0; i < maxMoves && consecutivePasses < 2; i++) {
            const moves = getSimValidMoves(b, color, prevBoard);
            if (moves.length === 0) {
                consecutivePasses++;
            } else {
                consecutivePasses = 0;
                // Random move selection with slight bias toward center
                const [mx, my] = moves[Math.floor(Math.random() * moves.length)];
                const oldBoard = cloneBoard(b);
                const result = tryMove(b, mx, my, color, prevBoard);
                if (result) {
                    prevBoard = oldBoard;
                    b = result;
                } else {
                    consecutivePasses++; // Treat failed move as pass
                }
            }
            color = color === BLACK ? WHITE : BLACK;
        }
        return scoreBoard(b);
    }

    /**
     * MCTS search: find the best move from the current position.
     * @param {string[][]} board - Current board state (array of char arrays)
     * @param {boolean[][]} validMoves - Valid moves from the game API
     * @param {number} timeBudgetMs - How long to search
     * @returns {{x: number, y: number} | null} Best move, or null to pass
     */
    function mctsSearch(board, validMoves, timeBudgetMs) {
        // Build list of candidate moves from the game's valid moves
        const candidates = [];
        for (let x = 0; x < validMoves.length; x++)
            for (let y = 0; y < validMoves[x].length; y++)
                if (validMoves[x][y]) candidates.push({ x, y, wins: 0, visits: 0 });

        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0]; // Only one option

        const simBoard = board.map(row => [...row]); // Mutable copy
        const deadline = performance.now() + timeBudgetMs;
        let iterations = 0;

        while (performance.now() < deadline) {
            // Select a candidate using UCB1
            const totalVisits = iterations + 1;
            let bestUcb = -Infinity, selected = candidates[0];
            for (const c of candidates) {
                if (c.visits === 0) { selected = c; break; } // Prioritize unvisited
                const ucb = (c.wins / c.visits) + 1.414 * Math.sqrt(Math.log(totalVisits) / c.visits);
                if (ucb > bestUcb) { bestUcb = ucb; selected = c; }
            }

            // Simulate: make the selected move, then random playout
            const afterMove = tryMove(simBoard, selected.x, selected.y, BLACK, null);
            if (!afterMove) { selected.visits++; iterations++; continue; } // Invalid in simulation

            const score = randomPlayout(afterMove, WHITE, simBoard);
            // We are BLACK (X). Win if we have more territory.
            if (score.black > score.white) selected.wins++;
            selected.visits++;
            iterations++;
        }

        // Pick the move with the highest win rate (not most visits, since time is limited)
        candidates.sort((a, b) => {
            if (a.visits === 0) return 1;
            if (b.visits === 0) return -1;
            return (b.wins / b.visits) - (a.wins / a.visits);
        });

        const best = candidates[0];
        if (best.visits === 0) return null; // No valid moves found in simulation
        ns.print(`MCTS: ${iterations} playouts in ${timeBudgetMs}ms. Best: (${best.x},${best.y}) win rate ${(best.wins / best.visits * 100).toFixed(1)}% (${best.visits} visits)`);
        return best;
    }

    // ==================== GAME LOOP ====================

    async function playGo() {
        // Check if there's a game in progress
        const currentGame = await ns.go.opponentNextTurn(false);
        if (currentGame.type === "gameOver") startNewGame();

        while (true) {
            const board = await getBoardState();
            const validMoves = await getValidMoves();
            const size = board[0].length;

            // Count empty spaces to determine game phase
            let emptyCount = 0;
            for (let x = 0; x < size; x++)
                for (let y = 0; y < size; y++)
                    if (board[x][y] === EMPTY) emptyCount++;

            const isEndgame = emptyCount < size * size * 0.2;
            const timeBudget = isEndgame ? mctsTimeEndgame : mctsTime;

            // Convert board from string[] to char[][] for the engine
            const simBoard = board.map(row => [...row]);

            // Try cheating first if available
            let results;
            if (cheats) {
                try {
                    const chance = await getCheatChance();
                    if (chance >= cheatThreshold) {
                        // Find two good moves using MCTS
                        const move1 = mctsSearch(simBoard, validMoves, Math.floor(timeBudget / 2));
                        if (move1) {
                            // Simulate move1, then find move2
                            const afterMove1 = tryMove(simBoard, move1.x, move1.y, BLACK, null);
                            if (afterMove1) {
                                const validMoves2 = [];
                                for (let x = 0; x < size; x++) {
                                    validMoves2[x] = [];
                                    for (let y = 0; y < size; y++)
                                        validMoves2[x][y] = afterMove1[x][y] === EMPTY && tryMove(afterMove1, x, y, BLACK, simBoard) !== null;
                                }
                                const move2 = mctsSearch(afterMove1, validMoves2, Math.floor(timeBudget / 2));
                                if (move2) {
                                    try {
                                        results = await cheatPlayTwo(move1.x, move1.y, move2.x, move2.y);
                                        ns.print(`CHEAT: Played (${move1.x},${move1.y}) and (${move2.x},${move2.y})`);
                                        checkGameOver(results);
                                        continue;
                                    } catch { /* Cheat failed, fall through to normal move */ }
                                }
                            }
                        }
                    }
                } catch { /* Cheats unavailable */ }
            }

            // Normal move via MCTS
            const bestMove = mctsSearch(simBoard, validMoves, timeBudget);
            if (bestMove) {
                try {
                    results = await ns.go.makeMove(bestMove.x, bestMove.y);
                } catch (err) {
                    ns.print(`Move failed: ${getErrorInfo(err)}. Passing.`);
                    results = await ns.go.passTurn();
                }
            } else {
                ns.print("No good moves found. Passing.");
                results = await ns.go.passTurn();
            }
            checkGameOver(results);
            await ns.sleep(1); // Yield to game loop to prevent lag
        }
    }

    function startNewGame() {
        const pool = cheats ? opponentsWithMystery : opponents;
        const opponent = pool[Math.floor(Math.random() * pool.length)];
        try { ns.go.resetBoardState(opponent, boardSize); }
        catch { ns.go.resetBoardState(opponents[Math.floor(Math.random() * opponents.length)], boardSize); }
        ns.print(`Starting new game vs ${opponent} on ${boardSize}x${boardSize}`);
    }

    function checkGameOver(results) {
        if (results.type === "gameOver") {
            if (runOnce) ns.exit();
            startNewGame();
        }
    }

    // Main loop with error recovery
    while (true) {
        try {
            await playGo();
        } catch (err) {
            log(ns, `WARNING: go.js error: ${getErrorInfo(err)}`, false, 'warning');
            await ns.sleep(10000);
        }
    }
}
