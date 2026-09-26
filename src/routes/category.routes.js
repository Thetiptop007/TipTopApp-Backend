const express = require('express');
const categoryController = require('../controllers/category.controller');
const { protect, restrictTo } = require('../middlewares/auth');
const categoryValidator = require('../validators/category.validator');
const { cacheMiddleware } = require('../middlewares/cache');

const router = express.Router();

// Public routes with caching
router.get(
  '/stats',
  cacheMiddleware(300, 'categories'),
  categoryController.getCategoryStats
);

router.get(
  '/',
  cacheMiddleware(300, 'categories'),
  categoryValidator.validate(categoryValidator.getCategoriesSchema),
  categoryController.getAllCategories
);

router.get(
  '/:id',
  cacheMiddleware(300, 'categories'),
  categoryValidator.validate(categoryValidator.getCategoryByIdSchema),
  categoryController.getCategoryById
);

// Protected routes - Admin only
router.use(protect('admin'));
router.use(restrictTo('admin'));

router.post(
  '/',
  categoryValidator.validate(categoryValidator.createCategorySchema),
  categoryController.createCategory
);

router.patch(
  '/:id',
  categoryValidator.validate(categoryValidator.updateCategorySchema),
  categoryController.updateCategory
);

router.patch(
  '/:id/toggle-status',
  categoryValidator.validate(categoryValidator.getCategoryByIdSchema),
  categoryController.toggleCategoryStatus
);

router.delete(
  '/:id',
  categoryValidator.validate(categoryValidator.getCategoryByIdSchema),
  categoryController.deleteCategory
);

module.exports = router;
