import LegalPageLayout from '@/components/LegalPageLayout'

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-bold text-white mt-8 mb-3">{children}</h2>
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-white/90 mt-5 mb-2">{children}</h3>
}
function Pending() {
  return <span className="text-amber-300/80 italic"> [pending Charlie's review]</span>
}

export default function Privacy() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="17 September 2026">
      <p>
        This Privacy Policy explains what personal data OneStat Analytics ("OneStat", "we", "us") collects
        through the app, why, who we share it with, and the rights you and your players have over it.
        OneStat is a GAA team-management and analytics platform used by club administrators and coaches
        ("club users") to record match, training, fitness and video data about their squad.
      </p>

      <H2>Who is responsible for your data?</H2>
      <p>
        Your club is the data controller for the player data entered into OneStat — your club decides what
        to record and who on your team can see it. OneStat acts as a data processor, providing the platform
        your club uses to store and analyse that data<Pending />.
      </p>

      <H2>What we collect</H2>
      <H3>Account &amp; club data</H3>
      <p>Name, email, and login details for club administrators and coaches (via AWS Cognito). Club name, colours, and badge.</p>

      <H3>Player data</H3>
      <p>
        Name, jersey number, position, date of birth (for age-grade squads), and status (active/injured/suspended).
        GAA squads routinely include players under 18 — see "Children's Data" below.
      </p>

      <H3>Match &amp; training data</H3>
      <p>
        Events recorded during matches and training (scores, turnovers, kickouts, and similar tactical
        events), attendance records, and video footage a coach chooses to upload and tag.
      </p>

      <H3>Physical performance data</H3>
      <p>
        GPS data (distance, sprints, speed), fitness test results, sleep logs, and workload indicators
        (e.g. Acute:Chronic Workload Ratio). These are training-load indicators for coaching purposes —
        OneStat is a sports performance platform, not a medical or health-monitoring product, and does not
        diagnose or assess medical conditions. This category of data is restricted to club administrators
        only within the app (not visible to every team member by default).
      </p>

      <H3>Opposition player data</H3>
      <p>
        Where a coach scouts an upcoming opponent, only the opposition player's surname is recorded — never
        a full name or any other personal detail. Opposition players are not OneStat users and have not
        consented to this; we minimise what's recorded to reduce that exposure.
      </p>

      <H3>AI-generated content</H3>
      <p>
        OneStat uses Anthropic's Claude models to generate match reports, insights, and answer coach
        questions in natural language. These conversations and their outputs are stored so a coach can
        revisit past analysis.
      </p>

      <H2>Children's data</H2>
      <p>
        GAA squads commonly include players under 18. We collect the minimum needed to run the squad (name,
        jersey number, position, DOB for age-grade eligibility) and apply the same access controls as adult
        players. We do not knowingly collect data directly from a child — all player data is entered by a
        club administrator or coach<Pending />.
      </p>

      <H2>Who we share it with</H2>
      <p>We use the following sub-processors to run the platform. None of them use your data for their own purposes beyond providing their service to us.</p>
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full text-sm my-4">
          <thead>
            <tr className="border-b border-white/10 text-white/50 text-left">
              <th className="py-2 pr-4">Provider</th>
              <th className="py-2">Purpose</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            <tr><td className="py-2 pr-4 text-white/90">Supabase</td><td className="py-2">Primary database hosting (PostgreSQL)</td></tr>
            <tr><td className="py-2 pr-4 text-white/90">Fly.io</td><td className="py-2">Backend application hosting</td></tr>
            <tr><td className="py-2 pr-4 text-white/90">Vercel</td><td className="py-2">Frontend application hosting</td></tr>
            <tr><td className="py-2 pr-4 text-white/90">Cloudflare R2</td><td className="py-2">Video and file storage</td></tr>
            <tr><td className="py-2 pr-4 text-white/90">AWS Cognito</td><td className="py-2">Login and authentication</td></tr>
            <tr><td className="py-2 pr-4 text-white/90">Anthropic (Claude)</td><td className="py-2">AI-generated analysis, reports, and chat</td></tr>
            <tr><td className="py-2 pr-4 text-white/90">Stripe</td><td className="py-2">Subscription billing</td></tr>
          </tbody>
        </table>
      </div>
      <p>We do not sell personal data, and we do not share it with third parties for their own marketing purposes.</p>

      <H2>Your rights</H2>
      <p>
        Depending on your role and location, you may have the right to access, correct, or request deletion
        of your personal data. A club administrator can permanently delete a player's record (including
        AI-generated content derived from it) from within the app. A player can opt out of appearing on
        teammate-visible leaderboards from their own player portal, while still seeing their own stats.
        To exercise other rights, contact your club administrator or us directly<Pending />.
      </p>

      <H2>Data retention</H2>
      <p>
        We do not currently apply an automatic deletion schedule to match/training data, since clubs
        typically want historical season records kept. A formal retention policy is planned<Pending />.
      </p>

      <H2>Security</H2>
      <p>
        Data is encrypted in transit. Access to player data within a club is restricted by role — coaches
        do not see other clubs' data, and sensitive performance data is restricted to club administrators.
      </p>

      <H2>Changes to this policy</H2>
      <p>We'll update this page when our practices change and update the "last updated" date above.</p>

      <H2>Contact</H2>
      <p>Questions about this policy or your data — contact us<Pending />.</p>
    </LegalPageLayout>
  )
}
