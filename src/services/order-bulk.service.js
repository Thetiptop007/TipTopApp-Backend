const mongoose = require('mongoose');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
  ALLOWED_BULK_STATUSES,
  MAX_BULK_ORDER_IDS,
} = require('../constants/order-status');
const {
  resolveTargetStatus,
  validateStatusTransition,
  buildBulkStatusNote,
  assertValidObjectId,
} = require('./order.service');

const bulkUpdateOrderStatus = async ({ orderIds, status, adminUserId }) => {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    throw new AppError('orderIds must be a non-empty array', 400);
  }

  if (orderIds.length > MAX_BULK_ORDER_IDS) {
    throw new AppError(`Cannot update more than ${MAX_BULK_ORDER_IDS} orders in one request`, 400);
  }

  if (!ALLOWED_BULK_STATUSES.includes(String(status).toUpperCase())) {
    throw new AppError('Invalid bulk status value', 400);
  }

  const requestedIds = [...new Set(orderIds.map((id) => String(id).trim()))];
  const adminObjectId = assertValidObjectId(adminUserId, 'admin user id');
  const objectIds = requestedIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const invalidIds = requestedIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));

  const session = await mongoose.startSession();
  session.startTransaction();

  const failedIds = [...invalidIds];
  const skippedIds = [];

  try {
    logger.info(
      `[BULK STATUS] Request size=${requestedIds.length}, status=${String(status).toUpperCase()}, invalidIds=${invalidIds.length}`
    );

    const orders = await Order.find({ _id: { $in: objectIds } })
      .select('_id status orderType orderNumber')
      .session(session)
      .lean();

    const ordersById = new Map(orders.map((order) => [order._id.toString(), order]));
    const now = new Date();
    const bulkOps = [];

    for (const id of requestedIds) {
      const order = ordersById.get(id);

      if (!order) {
        failedIds.push(id);
        continue;
      }

      const targetStatus = resolveTargetStatus(order, status);

      try {
        validateStatusTransition(order.status, targetStatus);
      } catch (error) {
        skippedIds.push(id);
        logger.warn(
          `[BULK STATUS] Skipped ${order.orderNumber || id}: ${order.status} → ${targetStatus} not allowed`
        );
        continue;
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: order._id, status: order.status },
          update: {
            $set: {
              status: targetStatus,
              updatedAt: now,
            },
            $push: {
              statusHistory: {
                status: targetStatus,
                timestamp: now,
                updatedBy: adminObjectId,
                notes: buildBulkStatusNote(targetStatus),
              },
            },
          },
        },
      });
    }

    if (bulkOps.length === 0) {
      await session.abortTransaction();
      return {
        totalRequested: requestedIds.length,
        matched: 0,
        modified: 0,
        skipped: skippedIds.length,
        failed: failedIds.length,
        failedIds,
      };
    }

    const result = await Order.bulkWrite(bulkOps, {
      session,
      ordered: false,
    });

    await session.commitTransaction();

    const matched = result.matchedCount || 0;
    const modified = result.modifiedCount || 0;
    const writeMismatches = Math.max(0, bulkOps.length - matched);
    const failed = failedIds.length + writeMismatches;

    logger.info(
      `[BULK STATUS] Completed status=${String(status).toUpperCase()} total=${requestedIds.length} matched=${matched} modified=${modified} skipped=${skippedIds.length} failed=${failed}`
    );

    if (failedIds.length > 0) {
      logger.warn(`[BULK STATUS] Failed IDs: ${failedIds.join(', ')}`);
    }

    if (writeMismatches > 0) {
      logger.warn(
        `[BULK STATUS] ${writeMismatches} order(s) did not match at write time due to concurrent status changes`
      );
    }

    return {
      totalRequested: requestedIds.length,
      matched,
      modified,
      skipped: skippedIds.length,
      failed,
      failedIds,
    };
  } catch (error) {
    await session.abortTransaction();
    logger.error('[BULK STATUS] Bulk update failed:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

module.exports = {
  MAX_BULK_ORDER_IDS,
  ALLOWED_BULK_STATUSES,
  bulkUpdateOrderStatus,
};
