# User Profile Management Feature

## Overview

This feature allows logged-in users to modify their own account data (username and password) through a dedicated user profile page.

## Files Created/Modified

### New Files

1. **`webPages/userProfile.ejs`** - User profile page template
   - Displays current user information
   - Form for modifying username and password
   - Client-side validation
   - Security features (requires current password for confirmation)

### Modified Files

1. **`main.js`** - Added three new routes:
   - `GET /userProfile` (lines 352-388) - Displays the user profile page
   - `GET /getCurrentUser` (lines 389-426) - API to get current logged-in user data
   - `POST /updateUserProfile` (lines 427-558) - API to update user profile

2. **`main.js`** - Updated login status box (line 580):
   - Added "🔐 Profilo" link to user profile page
   - Link appears when user is logged in

## Features

### 1. User Profile Page (`/api/adminUsers/userProfile`)

**Access:** Requires authentication (redirects to login if not authenticated)

**Functionality:**
- Displays current username and email
- Allows modification of username
- Allows modification of password
- Requires current password for security confirmation
- Client-side validation for all inputs
- Server-side validation with detailed error messages

**Security Features:**
- ✅ Authentication required
- ✅ Current password verification mandatory
- ✅ Username uniqueness check
- ✅ Password strength validation (minimum 6 characters)
- ✅ Input sanitization (username: alphanumeric + underscore + hyphen only)

### 2. Get Current User API (`/api/adminUsers/getCurrentUser`)

**Method:** GET

**Access:** Requires authentication

**Response:**
```json
{
  "username": "user123",
  "email": "user@example.com",
  "roleIds": [1, 100]
}
```

**Note:** Password hash is never exposed in the response

### 3. Update User Profile API (`/api/adminUsers/updateUserProfile`)

**Method:** POST

**Access:** Requires authentication

**Request Body:**
```json
{
  "newUsername": "newuser123",  // Optional - null to keep current
  "newPassword": "newpass123",  // Optional - null to keep current
  "currentPassword": "oldpass"  // Required - for security verification
}
```

**Validation Rules:**
- `currentPassword` - **Required** for all modifications
- `newUsername` - Optional:
  - Minimum 3 characters
  - Only alphanumeric, underscore, hyphen allowed
  - Must be unique (not already taken)
- `newPassword` - Optional:
  - Minimum 6 characters (8 recommended)
  - Must match confirmation field (client-side)

**Response (Success):**
```json
{
  "success": "Username modificato con successo. Password modificata con successo."
}
```

**Response (Error):**
```json
{
  "error": "Password attuale non corretta.",
  "errorField": "currentPassword"
}
```

### 4. Login Status Box Update

**Location:** Header hook (appears in top-right corner of all pages)

**When logged in, shows:**
```
ciao {username}
🔐 Profilo | Logout
```

**When not logged in, shows:**
```
non sei loggato
Login
```

## Usage

### Accessing User Profile

1. **Direct URL:** Navigate to `/api/adminUsers/userProfile`
2. **Login Status Box:** Click "🔐 Profilo" link (visible when logged in)

### Modifying Username

1. Enter new username in "Nuovo Username" field
2. Leave password fields empty (to keep current password)
3. Enter current password in "Password Attuale" field
4. Click "💾 Salva Modifiche"
5. **Important:** After username change, user will be logged out and redirected to login page (session username is updated, but re-login recommended for security)

### Modifying Password

1. Leave "Nuovo Username" field empty (to keep current username)
2. Enter new password in "Nuova Password" field
3. Re-enter new password in "Conferma Nuova Password" field
4. Enter current password in "Password Attuale" field
5. Click "💾 Salva Modifiche"

### Modifying Both Username and Password

1. Enter new username in "Nuovo Username" field
2. Enter new password in "Nuova Password" field
3. Re-enter new password in "Conferma Nuova Password" field
4. Enter current password in "Password Attuale" field
5. Click "💾 Salva Modifiche"
6. **Important:** Will be logged out and redirected to login page

## Theme Customization Support

The user profile page follows the **webPages/ convention** and supports theme customization via `themeSys`:

**Custom template location:**
```
themes/{themeName}/pluginsEndpointsMarkup/adminUsers/userProfile/
  template.ejs  # Custom template
  style.css     # Custom CSS
```

**Example:** To customize the user profile page in the "exampleTheme" theme:

1. Create directory:
   ```bash
   mkdir -p themes/exampleTheme/pluginsEndpointsMarkup/adminUsers/userProfile
   ```

2. Create `template.ejs` with custom layout (copy from `plugins/adminUsers/webPages/userProfile.ejs` as starting point)

3. Create `style.css` with custom styles:
   ```css
   .container {
     max-width: 800px;
     background: #f8f9fa;
     padding: 2rem;
     border-radius: 10px;
   }
   ```

## Security Considerations

### 1. Authentication
- All endpoints require active session (`ctx.session.authenticated`)
- Unauthenticated requests receive 401 Unauthorized

### 2. Password Verification
- Current password **must** be verified before any modification
- Uses bcrypt comparison for secure password validation

### 3. Username Validation
- Length check (minimum 3 characters)
- Character whitelist (alphanumeric + underscore + hyphen only)
- Uniqueness check (prevents duplicate usernames)

### 4. Password Validation
- Length check (minimum 6 characters, 8 recommended)
- Confirmation field (client-side)
- Bcrypt hashing with salt rounds = 10

### 5. Session Management
- Username change updates session: `ctx.session.user.name = newUsername`
- Auto-logout after username change (recommended for security)

### 6. Data Exposure
- Password hash is **never** returned in API responses
- User profile API returns only: username, email, roleIds

## File Operations

### Reading User Data
```javascript
const userAccount = loadJson5(userFilePath);
const userData = userAccount.users[username];
```

### Writing User Data
```javascript
// Username change: rename key in users object
userAccount.users[newUsername] = { ...userAccount.users[currentUsername] };
delete userAccount.users[currentUsername];

// Password change: update hashPassword
userAccount.users[username].hashPassword = hashedPassword;

// Save to file
fs.writeFileSync(userFilePath, JSON.stringify(userAccount, null, 2), 'utf8');
```

## Testing

### Manual Testing Steps

1. **Access Control:**
   - Visit `/api/adminUsers/userProfile` without logging in → Should redirect or show 401
   - Login, then visit `/api/adminUsers/userProfile` → Should display form

2. **Username Modification:**
   - Login as "testuser"
   - Change username to "testuser2"
   - Verify user list shows "testuser2"
   - Verify can login with "testuser2" (old username should fail)

3. **Password Modification:**
   - Login as user
   - Change password to "newpass123"
   - Logout
   - Login with new password → Should succeed
   - Login with old password → Should fail

4. **Validation:**
   - Try submitting without current password → Should show error
   - Try submitting without any changes → Should show error
   - Try username < 3 chars → Should show error
   - Try username with special chars → Should show error
   - Try password < 6 chars → Should show error
   - Try mismatched password confirmation → Should show error

5. **Security:**
   - Verify password hash not exposed in API responses
   - Verify current password is always required
   - Verify session updates correctly after username change

## Future Enhancements

Potential improvements for this feature:

1. **Email Modification:** Allow users to change their email address
2. **Profile Picture:** Add avatar/profile image upload
3. **Two-Factor Authentication:** Add 2FA setup option
4. **Password Strength Meter:** Visual indicator for password strength
5. **Activity Log:** Show recent login activity
6. **Account Deletion:** Allow users to delete their own account (with confirmation)
7. **Password Recovery:** Email-based password reset flow
8. **Username History:** Track username changes for audit purposes
9. **Rate Limiting:** Prevent brute-force attempts on password verification
10. **Email Verification:** Require email confirmation for email changes

## Troubleshooting

### Issue: "Non autenticato" error when accessing user profile
**Solution:** Ensure you are logged in. Visit `/api/adminUsers/login` first.

### Issue: "Password attuale non corretta" error
**Solution:** Double-check your current password. It must match exactly.

### Issue: "Il nuovo username è già in uso"
**Solution:** Choose a different username. The system prevents duplicate usernames.

### Issue: Changes saved but old username still shows
**Solution:** This shouldn't happen as the session is updated. If it does, logout and login again.

### Issue: Page layout broken or CSS not loading
**Solution:** Check that Bootstrap plugin is active and loaded correctly.

## Related Files

- **User Account Data:** `/plugins/adminUsers/userAccount.json5`
- **Authentication Library:** `/plugins/adminUsers/lib/libAccess.js`
- **Login/Logout Pages:** `/plugins/adminUsers/webPages/login.ejs`, `logout.ejs`
- **Admin User Management:** `/plugins/adminUsers/usersManagment/userUpsert.ejs` (different from user profile - admin-only)

## Differences: User Profile vs Admin User Management

| Feature | User Profile | Admin User Management |
|---------|--------------|----------------------|
| **Access** | Any logged-in user | Admin users only |
| **Scope** | Modify own account only | Modify any user account |
| **Password** | Requires current password | Admin can set without knowing current |
| **Username** | Can change own username | Can change any username |
| **Roles** | Cannot modify roles | Can assign/remove roles |
| **Email** | View only (future: edit) | Can modify any email |
| **Location** | `/api/adminUsers/userProfile` | `/admin/usersManagment/userUpsert.ejs` |

---

**Created:** 2026-01-06
**Author:** AI Assistant
**Version:** 1.0.0
