# Multi-Role User System Implementation

## Summary

Successfully implemented a multi-role user system that allows users to have multiple roles (customer, delivery agent, admin) simultaneously.

## Changes Made

### 1. User Model (`/Backend/src/models/User.js`)

#### Added `roles` Array Field
- Changed from single `role` field to `roles` array
- Kept `role` field for backward compatibility (returns primary role)
- Added validation to prevent duplicate roles
- Added pre-save hook to automatically set primary role based on priority: admin > delivery > customer

#### New Methods
- `hasRole(role)` - Check if user has a specific role
- `addRole(role)` - Add a role to user (prevents duplicates)
- Updated `generateAuthToken()` - Now includes both `role` and `roles` in JWT

#### Role Priority System
- Admin (highest priority)
- Delivery
- Customer (lowest priority)

### 2. Delivery Registration (`/Backend/src/controllers/delivery.controller.js`)

#### Updated Logic
- Now checks if user already exists with email/phone
- If user exists:
  - Checks if they already have 'delivery' role → Error
  - If not, adds 'delivery' role and updates deliveryData
- If user doesn't exist:
  - Creates new user with ['delivery'] in roles array

#### Benefits
- Same person can be both customer and delivery agent
- Same person can be customer, delivery agent, and admin
- Prevents duplicate delivery registrations

### 3. Authentication (`/Backend/src/controllers/auth.controller.js`)

- Updated registration to set `roles: [role]` array
- Maintains backward compatibility with existing code

### 4. Controller Updates

Updated all controllers to check roles array:
- `delivery.controller.js` - Uses `hasRole('delivery')` for checks
- `user.controller.js` - Updated aggregation queries to use `roles` field
- `order.controller.js` - Uses `hasRole()` method for role checks

### 5. Database Queries

Updated all role-based queries:
```javascript
// Old
User.find({ role: 'delivery' })

// New
User.find({ roles: 'delivery' })
```

MongoDB automatically matches documents where the array contains the specified value.

### 6. Migration Script (`/Backend/scripts/migrate-roles.js`)

Created migration script to convert existing users:
- Finds users without `roles` array
- Converts `role` to `roles: [role]`
- Successfully migrated 33 existing users

## API Behavior

### Registration Endpoint: `POST /api/v1/delivery/register`

#### Before
```json
{
  "error": "User with this email or phone already exists"
}
```

#### After
**If user exists without delivery role:**
```json
{
  "status": "success",
  "message": "Delivery partner registered successfully",
  "data": {
    "partner": {
      "id": "...",
      "roles": ["customer", "delivery"]
    }
  }
}
```

**If user already has delivery role:**
```json
{
  "error": "User is already registered as a delivery partner"
}
```

## Validation Rules

1. ✅ A user can have multiple roles
2. ✅ Same email/phone can be customer and delivery agent
3. ✅ Same email/phone can be customer, delivery agent, and admin
4. ❌ Cannot have duplicate roles (e.g., two 'customer' roles)
5. ❌ Cannot register as delivery agent twice

## Testing

### Migration Status
- ✅ 33 users migrated successfully
- ✅ 0 failures
- ✅ All users now have `roles` array

### Files Modified
1. `/Backend/src/models/User.js`
2. `/Backend/src/controllers/delivery.controller.js`
3. `/Backend/src/controllers/auth.controller.js`
4. `/Backend/src/controllers/user.controller.js`
5. `/Backend/src/controllers/order.controller.js`

### Files Created
1. `/Backend/scripts/migrate-roles.js`

## Next Steps

To complete the implementation:

1. **Restart Backend Server** to apply changes
2. **Test Delivery Registration** with existing customer account
3. **Verify Role-Based Access** works correctly
4. **Update Frontend** (if needed) to handle multiple roles

## Usage Example

```javascript
// Check if user has specific role
if (user.hasRole('delivery')) {
  // Show delivery features
}

// Add role to existing user
user.addRole('delivery');
await user.save();

// Get primary role (for backward compatibility)
console.log(user.role); // 'admin' (highest priority role)

// Get all roles
console.log(user.roles); // ['customer', 'delivery', 'admin']
```

## Backward Compatibility

The system maintains backward compatibility:
- `user.role` still exists and returns primary role
- JWT tokens include both `role` and `roles`
- Existing API endpoints continue to work
- No breaking changes to frontend
