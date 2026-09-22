import {
  activateContract,
  clientOfferContract,
  createOpportunity,
  getContractMilestones,
} from './clientFlow.js';
import {
  acceptContract,
  findOpportunities,
  sendProposal,
} from './designerFlow.js';
import { isWriteOk } from '../utils/helpers.js';

function failed(stage, ids = {}) {
  return { ok: false, stage, ...ids };
}


export function createPaymentReadyLifecycle(actor) {
  const opportunity = createOpportunity(actor.clientToken);
  if (!isWriteOk(opportunity.response) || !opportunity.opportunityId) {
    return failed('create_opportunity');
  }

  const opportunities = findOpportunities(actor.designerToken);
  if (!isWriteOk(opportunities.response)) {
    return failed('find_opportunities', { opportunityId: opportunity.opportunityId });
  }

  const proposal = sendProposal(actor.designerToken, opportunity.opportunityId);
  if (!isWriteOk(proposal.response) || !proposal.proposalId) {
    return failed('send_proposal', { opportunityId: opportunity.opportunityId });
  }

  const contract = clientOfferContract(actor.clientToken, proposal.proposalId);
  if (!isWriteOk(contract.response) || !contract.contractId) {
    return failed('offer_contract', {
      opportunityId: opportunity.opportunityId,
      proposalId: proposal.proposalId,
    });
  }

  const accepted = acceptContract(
    actor.designerToken,
    contract.contractId,
    opportunity.opportunityId
  );
  if (!isWriteOk(accepted.response)) {
    return failed('accept_contract', {
      opportunityId: opportunity.opportunityId,
      proposalId: proposal.proposalId,
      contractId: contract.contractId,
    });
  }

  const activated = activateContract(actor.clientToken, contract.contractId);
  if (!isWriteOk(activated.response)) {
    return failed('activate_contract', {
      opportunityId: opportunity.opportunityId,
      proposalId: proposal.proposalId,
      contractId: contract.contractId,
    });
  }

  const milestones = getContractMilestones(actor.clientToken, contract.contractId);
  if (!isWriteOk(milestones.response) || !milestones.milestoneId) {
    return failed('offered_milestone_id', {
      opportunityId: opportunity.opportunityId,
      proposalId: proposal.proposalId,
      contractId: contract.contractId,
    });
  }

  return {
    ok: true,
    opportunityId: opportunity.opportunityId,
    proposalId: proposal.proposalId,
    contractId: contract.contractId,
    milestoneId: milestones.milestoneId,
  };
}
