/**
 * Render-cost report: average render time per output minute, by video type, from completed projects.
 * Usage: npm --prefix server run metrics:render [-- --days 30]
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Project } from '../models/Project.js';

const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 30;
await mongoose.connect(env.mongodbUri);
const since = new Date(Date.now() - days * 86_400_000);
const rows = await Project.aggregate([
  { $match: { status: 'completed', lastRenderedAt: { $gte: since }, 'renderStats.renderMs': { $gt: 0 }, 'renderStats.outputDurationSec': { $gt: 0 } } },
  {
    $group: {
      _id: { mode: '$mode', style: '$renderStats.facelessStyle', resolution: '$settings.resolution' },
      renders: { $sum: 1 },
      renderSec: { $sum: { $divide: ['$renderStats.renderMs', 1000] } },
      outputSec: { $sum: '$renderStats.outputDurationSec' },
    },
  },
  { $sort: { '_id.mode': 1, '_id.style': 1 } },
]);
if (!rows.length) console.log(`No completed renders with timing in the last ${days} days.`);
for (const r of rows) {
  const label = [r._id.mode, r._id.style, r._id.resolution].filter(Boolean).join(' / ');
  const perMin = (r.renderSec / r.outputSec) * 60;
  console.log(`${label.padEnd(32)} renders ${String(r.renders).padStart(4)}   ${perMin.toFixed(1)} s of render per output minute`);
}
await mongoose.disconnect();
