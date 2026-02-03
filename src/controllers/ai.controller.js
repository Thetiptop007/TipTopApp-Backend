const catchAsync = require('../utils/catchAsync');
const { completePrompt } = require('../services/ai.service');

exports.complete = catchAsync(async (req, res) => {
  const { prompt, system } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ success: false, message: 'prompt is required' });
  }
  const result = await completePrompt(prompt, system);
  return res.status(200).json({ success: true, data: result });
});
