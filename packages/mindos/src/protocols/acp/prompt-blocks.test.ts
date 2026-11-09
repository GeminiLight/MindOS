import { describe, expect, it } from 'vitest';
import { buildAcpPromptBlocks } from './prompt-blocks.js';

/**
 * The ACP prompt used to be text-only, so a pasted screenshot reached the agent
 * as a file path it usually could not open. Images now travel as real content
 * blocks, but only for agents that declare the capability
 * (spec-acp-first-agent-integration Phase 1d).
 */

const png = { data: 'aGVsbG8=', mimeType: 'image/png' };

describe('ACP prompt blocks', () => {
  it('sends text alone when the turn has no images', () => {
    expect(buildAcpPromptBlocks('describe this', [], { image: true }))
      .toEqual([{ type: 'text', text: 'describe this' }]);
  });

  it('attaches images after the text for an agent that accepts them', () => {
    expect(buildAcpPromptBlocks('describe this', [png], { image: true })).toEqual([
      { type: 'text', text: 'describe this' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ]);
  });

  it('keeps every image when several are attached, in the order given', () => {
    const second = { data: 'd29ybGQ=', mimeType: 'image/jpeg' };

    expect(buildAcpPromptBlocks('compare', [png, second], { image: true }).slice(1)).toEqual([
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
      { type: 'image', data: 'd29ybGQ=', mimeType: 'image/jpeg' },
    ]);
  });

  it('drops images for an agent that never declared image support', () => {
    expect(buildAcpPromptBlocks('describe this', [png], {}))
      .toEqual([{ type: 'text', text: 'describe this' }]);
    expect(buildAcpPromptBlocks('describe this', [png], undefined))
      .toEqual([{ type: 'text', text: 'describe this' }]);
    expect(buildAcpPromptBlocks('describe this', [png], { image: false }))
      .toEqual([{ type: 'text', text: 'describe this' }]);
  });

  it('skips images with no data or no mime type rather than sending a broken block', () => {
    const images = [
      { data: '', mimeType: 'image/png' },
      { data: 'ok', mimeType: '' },
      { data: 'ok', mimeType: 'image/png' },
    ];

    expect(buildAcpPromptBlocks('x', images, { image: true }).slice(1))
      .toEqual([{ type: 'image', data: 'ok', mimeType: 'image/png' }]);
  });

  it('bounds how many images one prompt can carry', () => {
    const many = Array.from({ length: 30 }, () => png);

    expect(buildAcpPromptBlocks('x', many, { image: true })).toHaveLength(1 + 10);
  });

  it('still sends an image-only turn, where the text is empty', () => {
    expect(buildAcpPromptBlocks('', [png], { image: true })).toEqual([
      { type: 'text', text: '' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ]);
  });
});
