export const COLS = 6;
export const ROWS = 10;
export const TILE_KINDS = 5;

const CLEAR_MS = 350;
const FALL_MS = 200;
const RISE_MS = 12000;
const DANGER_MS = 5000;
const PRESSURE_MS = 2000;
const COMPUTER_MS = 2400;
const MAX_PENDING_ROWS = 3;

function hasTopTiles(board) {
  return board.cells.slice(0, COLS).some(tile => tile !== null);
}

function findMatches(cells) {
  const matched = new Set();
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS;) {
      const start = col;
      const kind = cells[row * COLS + col];
      col += 1;
      while (col < COLS && cells[row * COLS + col] === kind) col += 1;
      if (kind !== null && col - start >= 3) {
        for (let x = start; x < col; x += 1) matched.add(row * COLS + x);
      }
    }
  }
  for (let col = 0; col < COLS; col += 1) {
    for (let row = 0; row < ROWS;) {
      const start = row;
      const kind = cells[row * COLS + col];
      row += 1;
      while (row < ROWS && cells[row * COLS + col] === kind) row += 1;
      if (kind !== null && row - start >= 3) {
        for (let y = start; y < row; y += 1) matched.add(y * COLS + col);
      }
    }
  }
  return [...matched].sort((a, b) => a - b);
}

function applyGravity(cells) {
  let moved = false;
  for (let col = 0; col < COLS; col += 1) {
    let destination = ROWS - 1;
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      const source = row * COLS + col;
      if (cells[source] === null) continue;
      const target = destination * COLS + col;
      if (source !== target) {
        cells[target] = cells[source];
        cells[source] = null;
        moved = true;
      }
      destination -= 1;
    }
  }
  return moved;
}

export class PuzzleBattle {
  constructor(random = Math.random) {
    this.random = random;
    this._reset("ready");
  }

  _randomIndex(length) {
    const value = this.random();
    return Number.isFinite(value)
      ? Math.max(0, Math.min(length - 1, Math.floor(value * length)))
      : 0;
  }

  _chooseTile(left, secondLeft, above, secondAbove) {
    const choices = [];
    for (let kind = 0; kind < TILE_KINDS; kind += 1) {
      if (left === kind && secondLeft === kind) continue;
      if (above === kind && secondAbove === kind) continue;
      choices.push(kind);
    }
    // At most two kinds are excluded, so even a constant RNG terminates.
    return choices[this._randomIndex(choices.length)];
  }

  _nextRow(cells) {
    const row = [];
    for (let col = 0; col < COLS; col += 1) {
      row.push(this._chooseTile(
        row[col - 1], row[col - 2],
        cells[(ROWS - 1) * COLS + col], cells[(ROWS - 2) * COLS + col],
      ));
    }
    return row;
  }

  _makeBoard() {
    const cells = Array(COLS * ROWS).fill(null);
    const firstRow = ROWS - 5;
    const a = this._randomIndex(TILE_KINDS);
    const b = (a + 1 + this._randomIndex(TILE_KINDS - 1)) % TILE_KINDS;
    // Swapping the first pair makes b,a,a,a: an opening move without retries.
    const opening = [a, b, a, a, b, this._randomIndex(TILE_KINDS)];
    for (let col = 0; col < COLS; col += 1) cells[firstRow * COLS + col] = opening[col];
    for (let row = firstRow + 1; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const index = row * COLS + col;
        cells[index] = this._chooseTile(
          col > 0 ? cells[index - 1] : null,
          col > 1 ? cells[index - 2] : null,
          cells[index - COLS], cells[index - 2 * COLS],
        );
      }
    }
    return {
      cells,
      nextRow: this._nextRow(cells),
      phase: "idle",
      matches: [],
      chain: 0,
      cleared: 0,
      score: 0,
      pendingRows: 0,
      dangerMs: 0,
      riseMs: 0,
      message: "Swap neighbors to match three!",
    };
  }

  _reset(status) {
    this.state = {
      status,
      elapsed: 0,
      player: this._makeBoard(),
      rival: this._makeBoard(),
    };
    this._clocks = new Map([
      [this.state.player, { phaseMs: 0, pressureMs: 0 }],
      [this.state.rival, { phaseMs: 0, pressureMs: 0 }],
    ]);
    this._computerMs = 0;
  }

  start() {
    this._reset("playing");
  }

  pause() {
    if (this.state.status === "playing") this.state.status = "paused";
  }

  resume() {
    if (this.state.status === "paused") this.state.status = "playing";
  }

  swap(row, col) {
    if (this.state.status !== "playing" || this.state.player.phase !== "idle") return false;
    if (!Number.isInteger(row) || !Number.isInteger(col) ||
        row < 0 || row >= ROWS || col < 0 || col >= COLS - 1) return false;
    return this._swap(this.state.player, row * COLS + col);
  }

  _swap(board, index) {
    const cells = board.cells;
    if (cells[index] === cells[index + 1]) return false;
    [cells[index], cells[index + 1]] = [cells[index + 1], cells[index]];
    const matches = findMatches(cells);
    if (matches.length) {
      this._beginClear(board, matches, 1);
    } else {
      board.chain = 0;
      board.matches = [];
      board.message = "Keep building a match.";
      if (applyGravity(cells)) {
        board.phase = "fall";
        this._clocks.get(board).phaseMs = FALL_MS;
      }
    }
    this._resetSafeDanger(board);
    return true;
  }

  raise() {
    const board = this.state.player;
    if (this.state.status !== "playing" || board.phase !== "idle" || hasTopTiles(board)) return false;
    this._raiseRow(board);
    board.riseMs = 0;
    return true;
  }

  _raiseRow(board) {
    // Never shift away occupied top cells; the danger clock grants a rescue window.
    if (hasTopTiles(board)) return false;
    board.cells.copyWithin(0, COLS);
    for (let col = 0; col < COLS; col += 1) {
      board.cells[(ROWS - 1) * COLS + col] = board.nextRow[col];
    }
    board.nextRow = this._nextRow(board.cells);
    const matches = findMatches(board.cells);
    if (matches.length) this._beginClear(board, matches, 1);
    else board.message = hasTopTiles(board) ? "Near the top! Make a match!" : "A new row is here.";
    this._resetSafeDanger(board);
    return true;
  }

  _beginClear(board, matches, chain) {
    board.phase = "clear";
    board.matches = matches;
    board.chain = chain;
    this._clocks.get(board).phaseMs = CLEAR_MS;
    const sendsRow = matches.length >= 4 || chain >= 2;
    board.message = chain >= 2 ? `Chain ${chain}!` :
      matches.length >= 4 ? `Combo ${matches.length}!` : "Match three!";
    if (sendsRow) {
      const opponent = board === this.state.player ? this.state.rival : this.state.player;
      if (opponent.pendingRows < MAX_PENDING_ROWS) {
        if (opponent.pendingRows === 0) this._clocks.get(opponent).pressureMs = 0;
        opponent.pendingRows += 1;
        board.message += " Row sent!";
      }
    }
  }

  _finishPhase(board) {
    const clock = this._clocks.get(board);
    if (board.phase === "clear") {
      const count = board.matches.length;
      for (const index of board.matches) board.cells[index] = null;
      board.cleared += count;
      board.score += count * 10 * board.chain;
      board.matches = [];
      applyGravity(board.cells);
      board.phase = "fall";
      clock.phaseMs = FALL_MS;
      this._resetSafeDanger(board);
    } else if (board.phase === "fall") {
      const matches = findMatches(board.cells);
      if (matches.length) {
        this._beginClear(board, matches, board.chain + 1);
      } else {
        board.phase = "idle";
        board.chain = 0;
        clock.phaseMs = 0;
      }
    }
  }

  _resetSafeDanger(board) {
    if (!hasTopTiles(board)) board.dangerMs = 0;
  }

  _computerSwap() {
    const board = this.state.rival;
    const choices = [];
    const matching = [];
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS - 1; col += 1) {
        const index = row * COLS + col;
        if (board.cells[index] === board.cells[index + 1]) continue;
        choices.push(index);
        [board.cells[index], board.cells[index + 1]] = [board.cells[index + 1], board.cells[index]];
        if (findMatches(board.cells).length) matching.push(index);
        [board.cells[index], board.cells[index + 1]] = [board.cells[index + 1], board.cells[index]];
      }
    }
    if (!choices.length) return;
    // One-ply match spotting, with deliberate guesses rather than perfect search.
    const candidates = matching.length && this._randomIndex(4) < 3 ? matching : choices;
    this._swap(board, candidates[this._randomIndex(candidates.length)]);
  }

  tick(ms) {
    if (this.state.status !== "playing" || !Number.isFinite(ms) || ms <= 0) return;
    const boards = [this.state.player, this.state.rival];
    let remaining = ms;
    // Advance to the next event on either board, not frame-sized approximations.
    // This keeps simultaneous outcomes and seeded play independent of frame rate.
    while (remaining > 0 && this.state.status === "playing") {
      let step = remaining;
      for (const board of boards) {
        const clock = this._clocks.get(board);
        this._resetSafeDanger(board);
        const atTop = hasTopTiles(board);
        if (atTop) step = Math.min(step, Math.max(0, DANGER_MS - board.dangerMs));
        if (board.phase !== "idle") {
          step = Math.min(step, Math.max(0, clock.phaseMs));
        } else if (!atTop) {
          step = Math.min(step, Math.max(0, RISE_MS - board.riseMs));
          if (board.pendingRows > 0) {
            step = Math.min(step, Math.max(0, PRESSURE_MS - clock.pressureMs));
          }
        }
      }
      if (this.state.rival.phase === "idle") {
        step = Math.min(step, Math.max(0, COMPUTER_MS - this._computerMs));
      }

      this.state.elapsed += step;
      remaining -= step;
      for (const board of boards) {
        const clock = this._clocks.get(board);
        if (hasTopTiles(board)) board.dangerMs += step;
        if (board.phase !== "idle") {
          clock.phaseMs -= step;
        } else {
          board.riseMs = Math.min(RISE_MS, board.riseMs + step);
          if (board.pendingRows > 0) clock.pressureMs = Math.min(PRESSURE_MS, clock.pressureMs + step);
          if (board === this.state.rival) this._computerMs += step;
        }
      }

      // Resolve both boards before judging losses: a clear at the deadline saves
      // its board, and two expired danger clocks yield a draw without turn bias.
      for (const board of boards) {
        if (board.phase !== "idle" && this._clocks.get(board).phaseMs <= 0) {
          this._finishPhase(board);
        }
      }
      if (this.state.rival.phase === "idle" && this._computerMs >= COMPUTER_MS) {
        this._computerMs = 0;
        this._computerSwap();
      }
      for (const board of boards) {
        const clock = this._clocks.get(board);
        if (board.phase === "idle" && board.riseMs >= RISE_MS && !hasTopTiles(board)) {
          board.riseMs = 0;
          this._raiseRow(board);
        }
        if (board.phase === "idle" && board.pendingRows > 0 &&
            clock.pressureMs >= PRESSURE_MS && !hasTopTiles(board)) {
          board.pendingRows -= 1;
          clock.pressureMs = 0;
          this._raiseRow(board);
        }
        this._resetSafeDanger(board);
      }
      const playerLost = this.state.player.dangerMs >= DANGER_MS;
      const rivalLost = this.state.rival.dangerMs >= DANGER_MS;
      if (playerLost || rivalLost) {
        this.state.status = playerLost && rivalLost ? "draw" : playerLost ? "lost" : "won";
        if (playerLost) this.state.player.message = "Your stack reached the top.";
        if (rivalLost) this.state.rival.message = "Starfin's stack reached the top.";
      }
    }
  }
}
