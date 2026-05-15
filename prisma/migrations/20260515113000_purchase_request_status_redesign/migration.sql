-- Remap legacy purchase request statuses to canonical internal workflow statuses.
UPDATE `PurchaseRequest` SET `status` = 'new_request' WHERE `status` = 'pending';
UPDATE `PurchaseRequest` SET `status` = 'reviewing' WHERE `status` = 'contacted';
UPDATE `PurchaseRequest` SET `status` = 'fulfilled' WHERE `status` = 'completed';
UPDATE `PurchaseRequest` SET `status` = 'closed_lost' WHERE `status` = 'cancelled';

-- Set canonical default for newly created purchase requests.
ALTER TABLE `PurchaseRequest`
  MODIFY `status` VARCHAR(191) NOT NULL DEFAULT 'new_request';
