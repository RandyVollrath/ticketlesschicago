# TicketLess Chicago

An application that reminds Chicago residents about upcoming city obligations like city sticker registration and emissions testing, with optional auto-registration services.

## Features

- **Reminder System**: Get notified via email or SMS about upcoming obligations
- **City Sticker Tracking**: Annual Chicago vehicle sticker registration reminders
- **Emissions Testing**: Biennial Illinois emissions test notifications
- **Auto-Registration**: Optional service to handle registrations automatically
- **User Dashboard**: Track all your obligations and their due dates
- **Chicago-Specific**: Tailored for Chicago residents and Illinois requirements

## Tech Stack

- **Frontend**: Next.js with TypeScript and Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: Mock database (replace with PostgreSQL/MongoDB in production)
- **Notifications**: Email and SMS service integration (SendGrid, Twilio)
- **Authentication**: To be implemented (NextAuth.js recommended)

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd ticketless-chicago
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
```bash
cp .env.local.example .env.local
# Edit .env.local with your configuration
```

4. Run the development server
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

### Environment Variables

Create a `.env.local` file with:

```
# Database
DATABASE_URL="your-database-connection-string"

# Email Service (SendGrid, AWS SES, etc.)
EMAIL_SERVICE_API_KEY="your-email-service-key"
EMAIL_FROM_ADDRESS="noreply@ticketlesschicago.com"

# SMS Service (Twilio, etc.)
SMS_SERVICE_SID="your-sms-service-sid"
SMS_SERVICE_AUTH_TOKEN="your-sms-auth-token"
SMS_FROM_NUMBER="+1234567890"

# Auto-Registration Service
AUTO_REG_API_KEY="your-auto-registration-service-key"

# NextAuth (if implementing authentication)
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-nextauth-secret"
```

## Project Structure

```
ticketless-chicago/
├── pages/                  # Next.js pages and API routes
│   ├── api/               # Backend API endpoints
│   │   ├── users.ts       # User management
│   │   ├── obligations.ts # Obligation tracking
│   │   └── notifications/ # Notification processing
│   └── index.tsx          # Homepage
├── components/            # React components
├── lib/                   # Utility libraries
│   ├── database.ts        # Database operations
│   └── notifications.ts   # Notification service
├── types/                 # TypeScript type definitions
└── public/               # Static assets
```

## API Endpoints

- `GET/POST /api/users` - User registration and lookup
- `GET/POST/PATCH /api/obligations` - Obligation management
- `POST /api/notifications/process` - Process pending notifications

## Obligations Tracked

### Chicago City Sticker
- **Due Date**: July 31st annually
- **Cost**: ~$96.50 for regular vehicles
- **Requirements**: Vehicle registration, valid ID
- **Penalties**: $200+ ticket for expired sticker

### Illinois Emissions Testing
- **Due Date**: December 31st (biennial)
- **Cost**: ~$20 
- **Requirements**: Vehicles 4+ years old in Chicago area
- **Penalties**: Registration renewal blocked until completed

## Development Roadmap

### Phase 1: Core Features ✅
- [x] Basic project structure
- [x] User registration
- [x] Obligation tracking
- [x] Notification system
- [x] Database schema

### Phase 2: Enhanced Features
- [ ] User authentication
- [ ] Vehicle management dashboard
- [ ] Email/SMS notification integration
- [ ] Auto-registration service
- [ ] Payment processing

### Phase 3: Advanced Features
- [ ] Mobile app (React Native)
- [ ] Push notifications
- [ ] Calendar integration
- [ ] Multi-city support
- [ ] Affiliate/referral system

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This application is not affiliated with the City of Chicago or the State of Illinois. Users are responsible for ensuring compliance with all local and state requirements. The auto-registration service is a convenience feature and does not guarantee successful registration.