export default function PrivacyPolicy() {
  return (
    <div style={{ fontFamily: "Georgia, serif", background: "#07070B", minHeight: "100vh", color: "#e4e4e7", padding: "60px 24px" }}>
      <div style={{ maxWidth: "720px", margin: "0 auto" }}>
        <p style={{ color: "#a78bfa", fontSize: "11px", fontFamily: "system-ui", textTransform: "uppercase", letterSpacing: "0.1em" }}>Legal Document</p>
        <h1 style={{ fontSize: "36px", fontWeight: "bold", color: "white", margin: "12px 0 8px" }}>Privacy Policy</h1>
        <p style={{ color: "#71717a", fontSize: "13px", fontFamily: "system-ui" }}>Last updated: May 1, 2026</p>
        <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)", margin: "32px 0" }} />

        {[
          ["1. Introduction", "DentalBot AI operates an automated Instagram messaging service to help dental clinics manage patient inquiries and appointment scheduling. By interacting with our bot, you agree to the collection and use of information in accordance with this policy."],
          ["2. Information We Collect", "We collect: full name, phone number, dental photographs, Instagram user ID, message content, and timestamps of interactions — all provided voluntarily during the conversation."],
          ["3. How We Use Your Information", "We use your data to facilitate appointment scheduling, allow the dentist to review dental photographs, contact you to confirm your appointment, and improve our automated system."],
          ["4. Data Storage & Security", "Your data is stored securely using Supabase (SOC 2 Type II compliant). Photos are stored in encrypted cloud storage. We retain data only as long as necessary. Deletion requests are handled within 30 days."],
          ["5. Data Sharing", "We do not sell your data. It is shared only with: the dental clinic, Anthropic (AI processing), Meta/Instagram (message delivery), and Supabase (storage)."],
          ["6. Instagram & Meta Platform", "Our service uses Instagram's official Messaging API by Meta. We access only data necessary to provide our service — no profile, posts, or follower data."],
          ["7. Human Agent Availability", "A human representative is always available. Say 'I want to speak with a human' at any time to be connected with clinic staff."],
          ["8. Your Rights", "You have the right to access, correct, or delete your data, opt out of our service, and withdraw consent at any time. Contact us at the email below."],
          ["9. Children's Privacy", "Our service is not directed to children under 13. We do not knowingly collect their data."],
          ["10. Contact Us", "Email: privacy@dentalbot.ai | App: instagram-chat-bot.vercel.app | Response time: within 48 hours"],
        ].map(([title, content]) => (
          <div key={title} style={{ marginBottom: "40px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: "bold", color: "white", fontFamily: "system-ui", marginBottom: "12px" }}>{title}</h2>
            <p style={{ lineHeight: "1.7", color: "#a1a1aa" }}>{content}</p>
          </div>
        ))}

        <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)", margin: "48px 0 24px" }} />
        <p style={{ textAlign: "center", color: "#52525b", fontSize: "12px", fontFamily: "system-ui" }}>© 2026 DentalBot AI. All rights reserved.</p>
      </div>
    </div>
  );
}
