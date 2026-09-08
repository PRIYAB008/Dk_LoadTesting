
export const MILESTONE_TYPE = 'BxBlockDashboard::ContractMilestone';

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function isoDate(daysFromNow) {
  const d = new Date(Date.now() + (daysFromNow || 0) * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function ddmmyyyy(daysFromNow) {
  const d = new Date(Date.now() + (daysFromNow || 0) * 86400000);
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}
export function tag() {
  return `k6-vu${__VU}-iter${__ITER}`;
}

export const payloads = {
  createOpportunity: () => ({
    work_opportunity: {
      work_type: 'Concept creation',
      files: [],
      description: `k6 load-test work opportunity ${tag()}. Safe to delete.`,
      deliverables: 'One logo concept, source files, and a short rationale.',
      title: `k6 load test opportunity ${tag()}`,
      rate_amount: 20000,
      rate_type: 'overall',
      required_hours_per_week: 20,
      project_timeline: 4,
      files_or_links: '',
      start_date: isoDate(1),
      project_timeline_type: 'weeks',
      location: 'Remote',
      experience_level: 'Entry level',
      agree_to_terms_and_conditions: true,
      project_ids: [],
      question: '',
      skill_ids: [],
    },
  }),

  sendProposal: (opportunityId) => ({
    proposal: {
      work_opportunity_id: opportunityId,
      share_full_profile: 'true',
      answer: '',
      service_rate: 20000,
      give_your_pitch: `k6 load-test proposal ${tag()}. Safe to delete.`,
      terms_and_conditions: true,
      links: '',
      start_date: isoDate(1),
    },
  }),

  offerContract: (proposalId) => ({
    contract: {
      proposal_id: proposalId,
      decline_contract: 'false',
      terms_and_condition_accept: 'true',
      start_date: isoDate(1),
    },
    milestones: [
      {
        name: `Milestone 1 ${tag()}`,
        description: 'First milestone created by the k6 test.',
        deliverables: ['Initial concept'],
        amount: 10000,
        due_date: isoDate(14),
      },
      {
        name: `Milestone 2 ${tag()}`,
        description: 'Second milestone created by the k6 test.',
        deliverables: ['Final files'],
        amount: 10000,
        due_date: isoDate(28),
      },
    ],
  }),

  acceptContract: (contractId, opportunityId) => ({
    data: {
      attributes: {
        work_opportunity_id: opportunityId,
        contract_id: contractId,
      },
    },
  }),

  activateContract: (contractId) => ({
    data: { attributes: { contract_id: contractId } },
  }),

  addMilestone: (contractId) => ({
    data: {
      attributes: {
        contract_id: contractId,
        milestone_details: {
          name: `Milestone 3 ${tag()}`,
          description: 'Appended by the k6 test after contract creation.',
          deliverables: ['Handover pack'],
          amount: 5000,
          due_date: ddmmyyyy(42),
        },
      },
    },
  }),

  activateMilestone: (contractId, milestoneId) => ({
    data: { attributes: { contract_id: contractId, milestone_id: milestoneId } },
  }),

  payment: (contractId, milestoneId) => ({
    data: { attributes: { contract_id: contractId, milestone_id: milestoneId } },
  }),

  verifyPayment: (orderId) => ({ order_id: orderId }),

  approveWork: (contractId, milestoneId) => ({
    data: {
      attributes: {
        contract_id: contractId,
        milestone_id: milestoneId,
        milestone_type: MILESTONE_TYPE,
      },
    },
  }),
  submitWork: (contractId, milestoneId) => ({
    contract_id: contractId,
    contract_milestone_id: milestoneId,
    contract_milestone_type: MILESTONE_TYPE,
    message: `Work submitted by the k6 test ${tag()}.`,
    submission_links: ['https://example.com/k6-load-test-submission'],
  }),
};
