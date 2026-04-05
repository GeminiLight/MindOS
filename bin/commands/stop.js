/**
 * mindos stop — Stop running MindOS processes
 */

import { stopMindos } from '../lib/stop.js';

export const meta = {
  name: 'stop',
  group: 'Service',
  summary: 'Stop services',
  usage: 'mindos stop',
};

export const run = () => stopMindos();
