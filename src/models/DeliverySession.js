const mongoose = require('mongoose');

// Cash Order Sub-schema
const cashOrderSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
  },
  orderNumber: String,
  amount: {
    type: Number,
    required: true,
  },
  collectedAt: Date,
  status: {
    type: String,
    enum: ['collected', 'pending', 'cancelled'],
    default: 'pending',
  },
});

// Bonus Sub-schema
const bonusSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  description: String,
});

// DeliverySession Schema
const deliverySessionSchema = new mongoose.Schema(
  {
    deliveryPartner: {
      id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      name: String,
      phone: String,
    },

    sessionDate: {
      type: Date,
      required: true,
    },

    // Session Timing
    startTime: Date,
    endTime: Date,

    // Cash Management
    openingBalance: {
      type: Number,
      default: 0,
    },

    orders: [cashOrderSchema],

    // Totals
    totalExpected: {
      type: Number,
      default: 0,
    },
    totalCollected: {
      type: Number,
      default: 0,
    },
    totalToDeposit: {
      type: Number,
      default: 0,
    },

    // Settlement with admin
    settlement: {
      isSettled: {
        type: Boolean,
        default: false,
      },
      settledAt: Date,
      settledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      depositedAmount: Number,
      discrepancy: {
        type: Number,
        default: 0,
      },
      discrepancyReason: String,
      notes: String,
      receiptUrl: String,
    },

    // Session Statistics
    stats: {
      totalDeliveries: {
        type: Number,
        default: 0,
      },
      successfulDeliveries: {
        type: Number,
        default: 0,
      },
      cancelledDeliveries: {
        type: Number,
        default: 0,
      },
      rejectedOrders: {
        type: Number,
        default: 0,
      },
      totalDistance: {
        type: Number,
        default: 0,
      },
      averageDeliveryTime: {
        type: Number,
        default: 0,
      },
      earnings: {
        type: Number,
        default: 0,
      },
    },

    // Tips & Bonuses
    tips: {
      type: Number,
      default: 0,
    },
    bonuses: [bonusSchema],
  },
  {
    timestamps: true,
  }
);

// Indexes
deliverySessionSchema.index({ 'deliveryPartner.id': 1, sessionDate: -1 });
deliverySessionSchema.index({ sessionDate: -1 });
deliverySessionSchema.index({ 'settlement.isSettled': 1 });

// Calculate totals before saving
deliverySessionSchema.pre('save', function () {
  // Calculate total expected
  this.totalExpected = this.orders.reduce((sum, order) => {
    if (order.status === 'collected') {
      return sum + order.amount;
    }
    return sum;
  }, 0);

  // Calculate total to deposit
  this.totalToDeposit = this.totalCollected - this.openingBalance;

  // Calculate total bonuses
  const totalBonuses = this.bonuses.reduce((sum, bonus) => sum + bonus.amount, 0);
  this.stats.earnings = this.tips + totalBonuses;
});

// Static method to find active sessions
deliverySessionSchema.statics.findActiveSessions = function () {
  return this.find({
    endTime: null,
    'settlement.isSettled': false,
  }).sort({ startTime: -1 });
};

// Static method to find unsettled sessions
deliverySessionSchema.statics.findUnsettled = function () {
  return this.find({
    'settlement.isSettled': false,
    endTime: { $ne: null },
  }).sort({ sessionDate: -1 });
};

// Instance method to end session
deliverySessionSchema.methods.endSession = async function () {
  this.endTime = new Date();
  await this.save();
};

// Instance method to settle session
deliverySessionSchema.methods.settleSession = async function (settlementData) {
  this.settlement = {
    isSettled: true,
    settledAt: new Date(),
    settledBy: settlementData.settledBy,
    depositedAmount: settlementData.depositedAmount,
    discrepancy: this.totalToDeposit - settlementData.depositedAmount,
    discrepancyReason: settlementData.discrepancyReason,
    notes: settlementData.notes,
    receiptUrl: settlementData.receiptUrl,
  };
  await this.save();
};

module.exports = mongoose.model('DeliverySession', deliverySessionSchema);
