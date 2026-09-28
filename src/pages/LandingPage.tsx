import React from 'react';
import { ArrowRight, Bot, MessageSquare, Puzzle, ShoppingBag, CreditCard, Users, CheckCircle } from 'lucide-react';
import { AuthScreen } from './AuthScreen';

interface LandingPageProps {
  onSignedIn: () => void;
}

export function LandingPage({ onSignedIn }: LandingPageProps) {
  const [showAuth, setShowAuth] = React.useState(false);

  if (showAuth) {
    return <AuthScreen onSignedIn={onSignedIn} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <Bot className="h-8 w-8 text-indigo-600" />
              <span className="font-bold text-xl text-slate-900">Shwari</span>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setShowAuth(true)}
                className="text-slate-600 hover:text-slate-900 font-medium"
              >
                Sign In
              </button>
              <button 
                onClick={() => setShowAuth(true)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
              >
                Get Started Free
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-20 pb-16 lg:pt-32 lg:pb-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl lg:text-7xl font-extrabold text-slate-900 tracking-tight mb-8">
            The AI-Powered Platform <br className="hidden lg:block" />
            <span className="text-indigo-600">for Modern Businesses</span>
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-slate-600 mb-10">
            Automate customer support, manage omnichannel messaging, and scale your sales with a dedicated AI team. All from one centralized dashboard.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4 mb-16">
            <button 
              onClick={() => setShowAuth(true)}
              className="bg-indigo-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
            >
              Start Building Now <ArrowRight className="h-5 w-5" />
            </button>
            <a 
              href="#features"
              className="bg-white text-slate-700 px-8 py-4 rounded-xl font-bold text-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors flex items-center justify-center"
            >
              See How It Works
            </a>
          </div>
          
          {/* Hero Image */}
          <div className="relative mx-auto max-w-5xl">
            <div className="absolute inset-0 bg-gradient-to-t from-slate-50 via-transparent to-transparent z-10 bottom-0 h-40"></div>
            <img 
              src="/screenshots/overview-page.png" 
              alt="Shwari Platform Overview" 
              className="rounded-2xl shadow-2xl border border-slate-200"
            />
          </div>
        </div>
      </section>

      {/* Feature Section 1: AI Agents & Team */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 font-semibold text-sm mb-6">
                <Users className="h-4 w-4" /> Autonomous Workforce
              </div>
              <h2 className="text-4xl font-bold text-slate-900 mb-6">
                Hire a specialized AI Team instantly.
              </h2>
              <p className="text-lg text-slate-600 mb-8">
                Deploy customized AI agents to handle customer inquiries, process orders, and provide technical support. Train them on your specific business knowledge and watch them collaborate seamlessly.
              </p>
              <ul className="space-y-4">
                {[
                  'Custom persona and tone configuration',
                  'Connect to your own knowledge base',
                  'Agent-to-agent collaboration',
                  'Detailed performance analytics'
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-700">
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-8">
              <img src="/screenshots/shwari-agent-page.png" alt="Shwari AI Agent" className="rounded-xl shadow-lg border border-slate-200" />
              <img src="/screenshots/AI-Team-page.png" alt="AI Team Collaboration" className="rounded-xl shadow-lg border border-slate-200" />
            </div>
          </div>
        </div>
      </section>

      {/* Feature Section 2: Inbox & Integrations */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center lg:flex-row-reverse">
            <div className="order-1 lg:order-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-semibold text-sm mb-6">
                <MessageSquare className="h-4 w-4" /> Omnichannel Inbox
              </div>
              <h2 className="text-4xl font-bold text-slate-900 mb-6">
                Connect everywhere your customers are.
              </h2>
              <p className="text-lg text-slate-600 mb-8">
                Bring WhatsApp, Instagram, Telegram, and Webchat into a single unified inbox. Let your AI team handle the heavy lifting while your human agents step in only when needed.
              </p>
              <ul className="space-y-4">
                {[
                  'Unified multi-channel conversation view',
                  'Official Meta API Integration',
                  'One-click embedded signup for WhatsApp',
                  'Seamless human handoff'
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-700">
                    <CheckCircle className="h-5 w-5 text-blue-500 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-8 order-2 lg:order-1">
              <img src="/screenshots/inbox-page.png" alt="Unified Inbox" className="rounded-xl shadow-lg border border-slate-200" />
              <img src="/screenshots/Integrations-page.png" alt="Integrations Setup" className="rounded-xl shadow-lg border border-slate-200" />
            </div>
          </div>
        </div>
      </section>

      {/* Feature Section 3: Commerce */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 font-semibold text-sm mb-6">
            <ShoppingBag className="h-4 w-4" /> Complete Commerce
          </div>
          <h2 className="text-4xl font-bold text-slate-900 mb-6">
            Sell products, book services, collect payments.
          </h2>
          <p className="max-w-2xl mx-auto text-lg text-slate-600">
            Turn conversations into revenue. Your AI agents can showcase products, schedule appointments, and generate secure payment links automatically.
          </p>
        </div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-3 gap-8">
          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
            <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
              <ShoppingBag className="text-indigo-600" /> Products
            </h3>
            <img src="/screenshots/products-page.png" alt="Products Management" className="rounded-lg shadow-sm border border-slate-200 mb-4" />
            <p className="text-slate-600">Manage your digital and physical inventory effortlessly.</p>
          </div>
          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
            <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Puzzle className="text-indigo-600" /> Services
            </h3>
            <img src="/screenshots/services-page.png" alt="Services Management" className="rounded-lg shadow-sm border border-slate-200 mb-4" />
            <p className="text-slate-600">Define service packages and let AI handle the bookings.</p>
          </div>
          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
            <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
              <CreditCard className="text-indigo-600" /> Payments
            </h3>
            <img src="/screenshots/payments-page.png" alt="Payments Dashboard" className="rounded-lg shadow-sm border border-slate-200 mb-4" />
            <p className="text-slate-600">Track invoices, payment links, and revenue in real-time.</p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-indigo-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-extrabold text-white mb-8">
            Ready to scale your business with AI?
          </h2>
          <p className="text-xl text-indigo-100 mb-10">
            Join the businesses using Shwari to automate their customer operations and grow their revenue.
          </p>
          <button 
            onClick={() => setShowAuth(true)}
            className="bg-white text-indigo-600 px-10 py-4 rounded-xl font-bold text-lg hover:bg-slate-50 transition-colors shadow-xl"
          >
            Create Your Free Account
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-indigo-400" />
            <span className="font-bold text-lg text-white">Shwari</span>
          </div>
          <p className="text-slate-400 text-sm">
            &copy; {new Date().getFullYear()} Shwari. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
