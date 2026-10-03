# CineHook

CineHook is a full-stack movie ticket booking platform inspired by BookMyShow.

The project is being built with a production-oriented approach, focusing not only on features but also on system design, concurrency, authentication, payments, scalability, testing, and deployment.

## Core Flow

Movie Discovery → Theatre & Show Selection → Seat Selection → Temporary Seat Lock → Payment → Booking Confirmation → Digital Ticket

## Tech Stack

### Frontend
- React
- Vite
- TypeScript
- Tailwind CSS

### Backend
- Node.js
- Express.js
- TypeScript

### Data Layer
- PostgreSQL
- Prisma ORM
- Redis

### External Services
- Razorpay — Payments
- Cloudinary — Media Storage

### Infrastructure
- Docker
- Vercel
- Render / Railway / AWS

## Key Engineering Features

- JWT authentication and authorization
- Redis-based temporary seat locking
- Double-booking prevention
- PostgreSQL transactions and constraints
- Razorpay payment verification
- Failure recovery
- Stateless backend architecture
- Scalable system design

## Project Status

- Requirements — Completed
- High-Level Design — Completed
- Database Design — In Progress
