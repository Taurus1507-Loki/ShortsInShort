/**
 * Promote an existing, verified user to admin or super_admin:
 *   npm run seed:admin -- you@example.com super_admin
 * Bootstraps the first super admin; after that, super admins manage roles in the admin panel.
 */
import { env } from '../config/env.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { User, ROLES, type Role } from '../models/User.js';

const [email, role = 'admin'] = process.argv.slice(2);
if (!email || !(ROLES as readonly string[]).includes(role)) {
  console.error(`Usage: npm run seed:admin -- <email> [${ROLES.join('|')}]`);
  process.exit(1);
}

await connectDB(env.mongodbUri);
const user = await User.findOne({ email: email.toLowerCase() });
if (!user) {
  console.error('No user with that email. Register first.');
} else if (!user.emailVerifiedAt) {
  console.error('Verify the email address before granting an admin role.');
} else {
  user.role = role as Role;
  await user.save();
  console.log(`${user.email} is now ${role}.`);
}
await disconnectDB();
