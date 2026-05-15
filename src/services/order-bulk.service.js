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

  const failedIds = [...invalidIds];
  const skippedIds = [];

  try {
    logger.business('ORDER_BULK_STATUS_UPDATE_STARTED', 'Bulk order status update started', {
      requestedCount: requestedIds.length,
      status: String(status).toUpperCase(),
      invalidCount: invalidIds.length,
    }, { level: 'info' });

    const orders = await Order.find({ _id: { $in: objectIds } })
      .select('_id status orderType orderNumber')
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
        logger.business('ORDER_BULK_STATUS_UPDATE_SKIPPED', 'Bulk order status update skipped', {
          orderId: order._id.toString(),
          orderNumber: order.orderNumber || null,
          currentStatus: order.status,
          targetStatus,
        }, { level: 'warn', severity: 'medium' });
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
      ordered: false,
    });

    const matched = result.matchedCount || 0;
    const modified = result.modifiedCount || 0;
    const writeMismatches = Math.max(0, bulkOps.length - matched);
    const failed = failedIds.length + writeMismatches;

    logger.business('ORDER_BULK_STATUS_UPDATE_COMPLETED', 'Bulk order status update completed', {
      status: String(status).toUpperCase(),
      totalRequested: requestedIds.length,
      matched,
      modified,
      skipped: skippedIds.length,
      failed,
    }, { level: 'info' });

    if (failedIds.length > 0) {
      logger.business('ORDER_BULK_STATUS_UPDATE_FAILED', 'Bulk order status update had failed IDs', { failedIds, failedCount: failedIds.length }, { level: 'warn', severity: 'medium' });
    }

    if (writeMismatches > 0) {
      logger.business('ORDER_BULK_STATUS_UPDATE_FAILED', 'Bulk order status update write mismatches detected', { writeMismatches }, { level: 'warn', severity: 'medium' });
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
    logger.business('ORDER_BULK_STATUS_UPDATE_FAILED', 'Bulk order status update failed', { errorMessage: error.message }, { level: 'error', severity: 'high' });
    throw error;
  }
};

module.exports = {
  MAX_BULK_ORDER_IDS,
  ALLOWED_BULK_STATUSES,
  bulkUpdateOrderStatus,
  bulkAssignDeliveryPartner: async ({ orderIds, partnerId, adminUserId }) => {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      throw new AppError('orderIds must be a non-empty array', 400);
    }

    if (orderIds.length > MAX_BULK_ORDER_IDS) {
      throw new AppError(`Cannot update more than ${MAX_BULK_ORDER_IDS} orders in one request`, 400);
    }

    const User = require('../models/User');
    const partner = await User.findOne({
      _id: partnerId,
      role: 'delivery',
      isActive: true,
    });

    if (!partner) {
      throw new AppError('Delivery partner not found or not available', 404);
    }

    const requestedIds = [...new Set(orderIds.map((id) => String(id).trim()))];
    const adminObjectId = assertValidObjectId(adminUserId, 'admin user id');
    const objectIds = requestedIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const now = new Date();
    const bulkOps = [];
    const skippedIds = [];
    const failedIds = requestedIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));

    const orders = await Order.find({ _id: { $in: objectIds } })
      .select('_id status orderType orderNumber')
      .lean();

    const ordersById = new Map(orders.map((order) => [order._id.toString(), order]));

    for (const id of requestedIds) {
      const order = ordersById.get(id);
      if (!order) {
        failedIds.push(id);
        continue;
      }

      // Only READY orders can be assigned
      if (order.status !== 'READY') {
        skippedIds.push(id);
        continue;
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: order._id, status: 'READY' },
          update: {
            $set: {
              status: 'OUT_FOR_DELIVERY',
              'deliveryPartner.id': partner._id,
              'deliveryPartner.name': `${partner.name.first} ${partner.name.last}`,
              'deliveryPartner.phone': partner.phone.number,
              'deliveryPartner.vehicleNumber': partner.deliveryData?.vehicleNumber || 'N/A',
              'deliveryPartner.assignedAt': now,
              'deliveryPartner.pickedUpAt': now,
              updatedAt: now,
            },
            $push: {
              statusHistory: {
                status: 'OUT_FOR_DELIVERY',
                timestamp: now,
                updatedBy: adminObjectId,
                notes: 'Assigned delivery partner (Bulk)',
              },
            },
          },
        },
      });
    }

    if (bulkOps.length === 0) {
      return {
        totalRequested: requestedIds.length,
        matched: 0,
        modified: 0,
        skipped: skippedIds.length,
        failed: failedIds.length,
      };
    }

    const result = await Order.bulkWrite(bulkOps, { ordered: false });

    return {
      totalRequested: requestedIds.length,
      matched: result.matchedCount,
      modified: result.modifiedCount,
      skipped: skippedIds.length,
      failed: failedIds.length + (bulkOps.length - result.matchedCount),
    };
  },
};
