const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const { STATUS_TRANSITIONS } = require('../constants/order-status');

const normalizeStatus = (status) => String(status || '').trim().toUpperCase();

const resolveTargetStatus = (order, requestedStatus) => {
  const normalizedStatus = normalizeStatus(requestedStatus);

  if (normalizedStatus === 'READY' && order?.orderType === 'TAKEAWAY') {
    return 'READY_FOR_PICKUP';
  }

  return normalizedStatus;
};

const buildStatusNote = (targetStatus, actor = 'admin') => {
  if (targetStatus === 'DELIVERED') {
    return `Marked delivered by ${actor}`;
  }

  if (targetStatus === 'READY_FOR_PICKUP') {
    return `Marked ready for pickup by ${actor}`;
  }

  if (targetStatus === 'OUT_FOR_DELIVERY') {
    return `Marked out for delivery by ${actor}`;
  }

  if (targetStatus === 'READY') {
    return `Marked ready by ${actor}`;
  }

  if (targetStatus === 'ACCEPTED') {
    return `Marked accepted by ${actor}`;
  }

  if (targetStatus === 'CANCELLED') {
    return `Marked cancelled by ${actor}`;
  }

  return `Status updated to ${targetStatus} by ${actor}`;
};

const validateStatusTransition = (currentStatus, targetStatus) => {
  const normalizedCurrentStatus = normalizeStatus(currentStatus);
  const normalizedTargetStatus = normalizeStatus(targetStatus);
  const allowedCurrentStatuses = STATUS_TRANSITIONS[normalizedTargetStatus];

  if (!allowedCurrentStatuses) {
    throw new AppError(`Unsupported status: ${normalizedTargetStatus}`, 400);
  }

  if (!allowedCurrentStatuses.includes(normalizedCurrentStatus)) {
    throw new AppError(
      `Invalid status transition: ${normalizedCurrentStatus} → ${normalizedTargetStatus}`,
      400
    );
  }
};

const updateOrderStatus = async (order, requestedStatus, userId, note) => {
  const targetStatus = resolveTargetStatus(order, requestedStatus);
  validateStatusTransition(order.status, targetStatus);

  await order.updateStatus(
    targetStatus,
    userId,
    note || buildStatusNote(targetStatus)
  );

  return targetStatus;
};

const buildBulkStatusNote = (targetStatus) => `Bulk status update by admin to ${targetStatus}`;

const assertValidObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(`Invalid ${label}`, 400);
  }

  return new mongoose.Types.ObjectId(String(value));
};

module.exports = {
  normalizeStatus,
  resolveTargetStatus,
  buildStatusNote,
  buildBulkStatusNote,
  validateStatusTransition,
  updateOrderStatus,
  assertValidObjectId,
};