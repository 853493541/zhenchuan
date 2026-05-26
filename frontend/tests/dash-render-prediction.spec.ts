import { expect, test } from '@playwright/test';
import { predictDashRenderPosition, shouldLogDashServerGap, type DashRenderSample } from '../app/game/screens/in-game/components/BattleArena/dashRenderPrediction';

function sample(overrides: Partial<DashRenderSample> = {}): DashRenderSample {
  return {
    position: { x: 10, y: 20, z: 3 },
    sampledAtMs: 1000,
    ticksRemaining: 30,
    vxPerTick: 0.6,
    vyPerTick: -0.2,
    vzPerTick: 0.1,
    ...overrides,
  };
}

test('dash render prediction moves before the next server movement sample', () => {
  const predicted = predictDashRenderPosition(sample(), { nowMs: 1000 + 1000 / 60 });

  expect(predicted).not.toBeNull();
  expect(predicted!.x).toBeGreaterThan(10);
  expect(predicted!.y).toBeLessThan(20);
  expect(predicted!.z).toBeGreaterThan(3);
});

test('dash render prediction caps lead so jitter cannot run far ahead of server', () => {
  const predicted = predictDashRenderPosition(sample(), { nowMs: 1800 });

  expect(predicted).toEqual({
    x: 22,
    y: 16,
    z: 5,
  });
});

test('dash render prediction bridges observed 224ms server sample gaps', () => {
  const predicted = predictDashRenderPosition(sample(), { nowMs: 1224 });

  expect(predicted!.x).toBeCloseTo(14.032, 3);
  expect(predicted!.y).toBeCloseTo(18.656, 3);
  expect(predicted!.z).toBeCloseTo(3.672, 3);
});

test('dash render prediction bridges observed 448ms server sample gaps', () => {
  const predicted = predictDashRenderPosition(sample(), { nowMs: 1448 });

  expect(predicted!.x).toBeCloseTo(18.064, 3);
  expect(predicted!.y).toBeCloseTo(17.312, 3);
  expect(predicted!.z).toBeCloseTo(4.344, 3);
});

test('dash render prediction bridges representative activeDash shapes without ability-specific logic', () => {
  const cases = [
    {
      label: 'horizontal forward dash',
      dash: sample({ ticksRemaining: 30, vxPerTick: 0.8, vyPerTick: 0, vzPerTick: 0 }),
      expected: { x: 15.376, y: 20, z: 3 },
    },
    {
      label: 'short ground-target dash',
      dash: sample({ ticksRemaining: 15, vxPerTick: 0, vyPerTick: 1.1, vzPerTick: 0 }),
      expected: { x: 10, y: 27.392, z: 3 },
    },
    {
      label: 'knockback dash',
      dash: sample({ ticksRemaining: 18, vxPerTick: -0.7, vyPerTick: 0.35, vzPerTick: 0 }),
      expected: { x: 5.296, y: 22.352, z: 3 },
    },
    {
      label: 'vertical lift dash',
      dash: sample({ ticksRemaining: 15, vxPerTick: 0, vyPerTick: 0, vzPerTick: 0.65 }),
      expected: { x: 10, y: 20, z: 7.368 },
    },
  ];

  for (const { label, dash, expected } of cases) {
    const predicted = predictDashRenderPosition(dash, { nowMs: 1224 });

    expect(predicted, label).not.toBeNull();
    expect(predicted!.x, label).toBeCloseTo(expected.x, 3);
    expect(predicted!.y, label).toBeCloseTo(expected.y, 3);
    expect(predicted!.z, label).toBeCloseTo(expected.z, 3);
  }
});

test('dash render prediction does not exceed remaining dash ticks', () => {
  const predicted = predictDashRenderPosition(sample({ ticksRemaining: 1 }), { nowMs: 1400 });

  expect(predicted).toEqual({
    x: 10.6,
    y: 19.8,
    z: 3.1,
  });
});

test('dash server gap diagnostics only log meaningful update delays', () => {
  expect(shouldLogDashServerGap(33)).toBe(false);
  expect(shouldLogDashServerGap(224)).toBe(false);
  expect(shouldLogDashServerGap(448)).toBe(false);
  expect(shouldLogDashServerGap(650)).toBe(true);
});