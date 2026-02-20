import { describe, it, expect } from 'vitest';
import { snapToGrid } from './snapToGrid';

describe('snapToGrid', () => {
  it('snaps to nearest 15-minute boundary within gap', () => {
    // rawMinutes=557 (09:17), itemDuration=45, gapStart=530 (08:50), gapEnd=600 (10:00)
    // snapped = round(557/15)*15 = round(37.13)*15 = 37*15 = 555 (09:15)
    // earliest = ceil(530/15)*15 = ceil(35.33)*15 = 36*15 = 540 (09:00)
    // latest = floor((600-45)/15)*15 = floor(37)*15 = 555 (09:15)
    // result = max(540, min(555, 555)) = 555
    expect(snapToGrid(557, 45, 530, 600)).toBe(555);
  });

  it('returns null when gap is too small for the item', () => {
    // rawMinutes=580, itemDuration=45, gapStart=580 (09:40), gapEnd=600 (10:00)
    // earliest = ceil(580/15)*15 = ceil(38.67)*15 = 39*15 = 585
    // latest = floor((600-45)/15)*15 = floor(37)*15 = 555
    // earliest(585) > latest(555) → null
    expect(snapToGrid(580, 45, 580, 600)).toBeNull();
  });

  it('snaps to earliest when drop is too early', () => {
    // rawMinutes=530 (08:50), itemDuration=45, gapStart=540 (09:00), gapEnd=660 (11:00)
    // snapped = round(530/15)*15 = round(35.33)*15 = 35*15 = 525
    // earliest = ceil(540/15)*15 = 36*15 = 540
    // latest = floor((660-45)/15)*15 = floor(41)*15 = 615
    // result = max(540, min(615, 525)) = max(540, 525) = 540
    expect(snapToGrid(530, 45, 540, 660)).toBe(540);
  });

  it('snaps to latest when drop is too late', () => {
    // rawMinutes=620 (10:20), itemDuration=45, gapStart=540 (09:00), gapEnd=660 (11:00)
    // snapped = round(620/15)*15 = round(41.33)*15 = 41*15 = 615
    // earliest = 540
    // latest = floor((660-45)/15)*15 = floor(41)*15 = 615
    // result = max(540, min(615, 615)) = 615
    expect(snapToGrid(620, 45, 540, 660)).toBe(615);
  });

  it('returns earliest when gap exactly fits one slot', () => {
    // gapStart=540 (09:00), gapEnd=585 (09:45), itemDuration=45
    // earliest = ceil(540/15)*15 = 540
    // latest = floor((585-45)/15)*15 = floor(36)*15 = 540
    // snapped = 540
    // result = 540
    expect(snapToGrid(540, 45, 540, 585)).toBe(540);
  });

  it('handles item that exactly fills the gap at a 15-min boundary', () => {
    // gapStart=480 (08:00), gapEnd=525 (08:45), itemDuration=45
    // earliest = 480, latest = floor((525-45)/15)*15 = floor(32)*15 = 480
    // result = 480
    expect(snapToGrid(490, 45, 480, 525)).toBe(480);
  });

  it('snaps correctly when gap start is not on a 15-min boundary', () => {
    // gapStart=533 (08:53), gapEnd=600 (10:00), itemDuration=30
    // earliest = ceil(533/15)*15 = ceil(35.53)*15 = 36*15 = 540 (09:00)
    // latest = floor((600-30)/15)*15 = floor(38)*15 = 570 (09:30)
    // rawMinutes=545 → snapped = round(545/15)*15 = round(36.33)*15 = 36*15 = 540
    // result = max(540, min(570, 540)) = 540
    expect(snapToGrid(545, 30, 533, 600)).toBe(540);
  });
});
