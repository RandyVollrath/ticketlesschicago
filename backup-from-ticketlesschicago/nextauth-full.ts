import NextAuth, { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { supabaseAdmin } from '../../../lib/supabase';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      // Add service access to token when user signs in
      if (user?.email) {
        const { data: userData } = await supabaseAdmin
          .from('vehicle_reminders')
          .select('*')
          .eq('email', user.email)
          .single();
        
        if (userData) {
          token.userId = userData.user_id;
          token.subscription_status = userData.subscription_status;
          token.service_plan = userData.service_plan;
          token.service_access = userData.service_access || {
            ticketless: false,
            mystreetcleaning: false
          };
        }
      }
      return token;
    },
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        try {
          // Check if user exists in our database
          const { data: existingUser } = await supabaseAdmin
            .from('vehicle_reminders')
            .select('*')
            .eq('email', user.email)
            .single();

          if (!existingUser && user.email) {
            // Create a new user record if they don't exist
            const { data: authUser } = await supabaseAdmin.auth.admin.createUser({
              email: user.email,
              email_confirm: true,
              user_metadata: {
                full_name: user.name,
                avatar_url: user.image,
                provider: 'google'
              }
            });

            if (authUser?.user) {
              // Create initial vehicle reminder record (empty, to be filled later)
              await supabaseAdmin
                .from('vehicle_reminders')
                .insert([{
                  user_id: authUser.user.id,
                  email: user.email,
                  license_plate: '',
                  zip_code: '',
                  city_sticker_expiry: new Date(new Date().getFullYear() + 1, 0, 1).toISOString().split('T')[0],
                  license_plate_expiry: new Date(new Date().getFullYear() + 1, 0, 1).toISOString().split('T')[0],
                  phone: '',
                  notification_preferences: {
                    email: true,
                    sms: false,
                    voice: false,
                    reminder_days: [30, 14, 7, 3, 1]
                  },
                  service_plan: 'free',
                  subscription_status: 'trial'
                }]);
            }
          }
          return true;
        } catch (error) {
          console.error('Error during sign in:', error);
          return false;
        }
      }
      return true;
    },
    async session({ session, token }) {
      // Add user ID and service access to session
      if (session.user?.email) {
        const { data: userData } = await supabaseAdmin
          .from('vehicle_reminders')
          .select('*')
          .eq('email', session.user.email)
          .single();
        
        if (userData) {
          session.user.id = userData.user_id;
          session.user.subscription_status = userData.subscription_status;
          session.user.service_plan = userData.service_plan;
          
          // Add service access information
          session.user.service_access = userData.service_access || {
            ticketless: false,
            mystreetcleaning: false
          };
          
          // Check if this is a TicketLess user (for this app)
          session.user.hasTicketLessAccess = userData.service_access?.ticketless || false;
          session.user.hasMSCAccess = userData.service_access?.mystreetcleaning || false;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);