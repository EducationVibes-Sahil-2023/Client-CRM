<?php

use CodeIgniter\Router\RouteCollection;

/** @var RouteCollection $routes */

// Auto-routing is disabled by default in the appstarter; every endpoint is
// declared explicitly so that route-group auth filters can never be bypassed.

$routes->get('/', 'Home::index');

// Public (no auth) — marketing site lead capture + content
$routes->get('landing', 'PublicController::landing');
$routes->post('contact', 'PublicController::contact');
$routes->post('demo-request', 'PublicController::demoRequest');

// Authentication
$routes->group('auth', static function (RouteCollection $routes) {
    $routes->post('login', 'Auth::login');
    $routes->post('logout', 'Auth::logout');
    $routes->get('me', 'Auth::me');
});

// Super Admin area (requires a logged-in super_admin)
$routes->group('superadmin', ['filter' => 'auth:super_admin'], static function (RouteCollection $routes) {
    $routes->get('dashboard', 'SuperAdmin::dashboard');
    $routes->get('overview', 'SuperAdmin::overview');
    $routes->get('clients', 'SuperAdmin::clients');
    $routes->post('clients', 'SuperAdmin::createClient');
    $routes->get('clients/(:num)/schema', 'SuperAdmin::clientSchema/$1');
    $routes->get('clients/(:num)/data/(:segment)', 'SuperAdmin::clientTableData/$1/$2');
    $routes->get('clients/(:num)/features', 'SuperAdmin::clientFeatures/$1');
    $routes->post('clients/(:num)/features', 'SuperAdmin::saveClientFeatures/$1');
    $routes->post('clients/(:num)/status', 'SuperAdmin::updateClientStatus/$1');
    $routes->post('clients/(:num)/delete', 'SuperAdmin::deleteClient/$1');
    $routes->post('clients/(:num)', 'SuperAdmin::updateClient/$1');
    $routes->post('upload', 'SuperAdmin::upload');
    $routes->post('feature-toggle', 'SuperAdmin::toggleFeature');
    $routes->post('admins', 'SuperAdmin::createAdmin');

    // Landing page content management
    $routes->get('landing', 'SuperAdmin::landing');
    $routes->post('landing', 'SuperAdmin::saveLanding');
    $routes->post('landing/logo', 'SuperAdmin::uploadLogo');

    // Gmail inbox (read real email over IMAP)
    $routes->get('inbox', 'SuperAdmin::inbox');
    $routes->get('inbox/(:num)', 'SuperAdmin::inboxMessage/$1');

    // Gmail inbox settings (managed from the admin panel, stored in DB)
    $routes->get('integrations/gmail', 'SuperAdmin::gmailSettings');
    $routes->post('integrations/gmail', 'SuperAdmin::saveGmailSettings');
    $routes->post('integrations/gmail/test', 'SuperAdmin::testGmailSettings');
    $routes->post('integrations/email-test', 'SuperAdmin::emailTest');
    $routes->post('integrations/signature', 'SuperAdmin::saveEmailSignature');

    // Google Calendar integration settings (service account, stored in DB)
    $routes->get('integrations/google-calendar', 'SuperAdmin::googleCalendarSettings');
    $routes->post('integrations/google-calendar', 'SuperAdmin::saveGoogleCalendarSettings');
    $routes->post('integrations/google-calendar/test', 'SuperAdmin::testGoogleCalendarSettings');

    // Lead capture inbox
    $routes->get('contact-messages', 'SuperAdmin::contactMessages');
    $routes->get('demo-requests', 'SuperAdmin::demoRequests');
    $routes->post('demo-requests/(:num)/read', 'SuperAdmin::markDemoRead/$1');
    $routes->post('demo-requests/(:num)/replied', 'SuperAdmin::markDemoReplied/$1');
    $routes->post('demo-requests/(:num)/delete', 'SuperAdmin::deleteDemo/$1');
    $routes->post('contact-messages/(:num)/read', 'SuperAdmin::markContactRead/$1');
    $routes->post('contact-messages/(:num)/replied', 'SuperAdmin::markContactReplied/$1');
    $routes->post('contact-messages/(:num)/delete', 'SuperAdmin::deleteContact/$1');

    // Notifications (derived from new demo/contact submissions)
    $routes->get('notifications', 'SuperAdmin::notifications');
    $routes->post('notifications/read-all', 'SuperAdmin::markAllRead');

    // Activity log (full history across demo/contact/clients)
    $routes->get('activity', 'SuperAdmin::activity');

    // Inbox messages (Sent folder / compose)
    $routes->get('messages', 'SuperAdmin::messages');
    $routes->post('messages', 'SuperAdmin::sendMessage');
    $routes->post('messages/(:num)/delete', 'SuperAdmin::deleteMessage/$1');

    // Calendar events
    $routes->get('events', 'SuperAdmin::events');
    $routes->post('events', 'SuperAdmin::createEvent');
    $routes->post('events/(:num)', 'SuperAdmin::updateEvent/$1');
    $routes->post('events/(:num)/delete', 'SuperAdmin::deleteEvent/$1');

    // Google Calendar meetings
    $routes->post('meetings', 'SuperAdmin::createMeeting');

    // Chat (super-admin ↔ client support) + in-app notifications
    $routes->get('chat/conversations', 'ChatController::conversations');
    $routes->post('chat/conversations/start', 'ChatController::startConversation');
    $routes->get('chat/conversations/(:num)/messages', 'ChatController::messages/$1');
    $routes->post('chat/conversations/(:num)/messages', 'ChatController::sendMessage/$1');
    $routes->get('chat/poll', 'ChatController::poll');
    $routes->get('chat/notifications', 'ChatController::notifications');
    $routes->post('chat/notifications/read-all', 'ChatController::readAllNotifications');
    $routes->post('chat/notifications/(:num)/read', 'ChatController::readNotification/$1');

    // Profile / account
    $routes->get('profile', 'SuperAdmin::profile');
    $routes->post('profile', 'SuperAdmin::updateProfile');
    $routes->post('profile/avatar', 'SuperAdmin::uploadAvatar');
    $routes->post('password', 'SuperAdmin::changePassword');
});

// Staff area (requires a logged-in client_staff member)
$routes->group('staff', ['filter' => 'auth:staff'], static function (RouteCollection $routes) {
    $routes->get('me', 'StaffController::me');
    $routes->get('dashboard', 'StaffController::dashboard');

    // Announcements (broadcast to me / my department / all team)
    $routes->get('announcements', 'StaffController::announcements');
    $routes->post('announcements/(:num)/read', 'StaffController::markAnnouncementRead/$1');
    $routes->post('announcements/(:num)/ack', 'StaffController::acknowledgeAnnouncement/$1');

    // Chat (team room + 1:1 DMs with admins and other staff) + notifications
    $routes->get('chat/conversations', 'ChatController::conversations');
    $routes->get('chat/directory', 'ChatController::directory');
    $routes->post('chat/dm/start', 'ChatController::startDm');
    $routes->get('chat/conversations/(:num)/messages', 'ChatController::messages/$1');
    $routes->post('chat/conversations/(:num)/messages', 'ChatController::sendMessage/$1');
    $routes->get('chat/poll', 'ChatController::poll');
    $routes->get('chat/notifications', 'ChatController::notifications');
    $routes->post('chat/notifications/read-all', 'ChatController::readAllNotifications');
    $routes->post('chat/notifications/(:num)/read', 'ChatController::readNotification/$1');
});

// Client dashboard — shared by the client admin and their staff. Staff access is
// constrained per-module/per-row inside ClientController (admins are unconstrained).
$routes->group('client', ['filter' => 'auth:client_admin,staff'], static function (RouteCollection $routes) {
    $routes->get('me', 'ClientController::me');
    // Per-user table layout (visible columns, order, widths, alignment).
    $routes->get('table-prefs/(:segment)', 'ClientController::tablePrefs/$1');
    $routes->post('table-prefs/(:segment)', 'ClientController::saveTablePrefs/$1');
    // Client-wide custom column names (read by all; write by client admin only).
    $routes->get('table-labels/(:segment)', 'ClientController::tableLabels/$1');
    $routes->post('table-labels/(:segment)', 'ClientController::saveTableLabels/$1');
    $routes->get('dashboard', 'ClientController::dashboard');
    $routes->get('settings', 'ClientController::settings');
    $routes->post('settings', 'ClientController::saveSettings');
    $routes->get('branding', 'ClientController::branding');
    $routes->get('features', 'ClientController::features');
    $routes->get('activity', 'ClientController::activity');
    $routes->get('billing', 'ClientController::billing');

    // Email (Gmail/IMAP) + Google Calendar integrations (gated by 'email_config')
    $routes->group('', ['filter' => 'feature:email_config'], static function (RouteCollection $routes) {
        $routes->get('integrations/gmail', 'ClientController::gmailSettings');
        $routes->post('integrations/gmail', 'ClientController::saveGmailSettings');
        $routes->post('integrations/gmail/test', 'ClientController::testGmailSettings');
        $routes->post('integrations/email-test', 'ClientController::emailTest');
        $routes->get('inbox', 'ClientController::inbox');
        $routes->get('inbox/(:num)', 'ClientController::inboxMessage/$1');
        $routes->get('integrations/google-calendar', 'ClientController::googleCalendarSettings');
        $routes->post('integrations/google-calendar', 'ClientController::saveGoogleCalendarSettings');
        $routes->post('integrations/google-calendar/test', 'ClientController::testGoogleCalendarSettings');
    });

    // Roles & permissions (gated by the 'roles' plan feature)
    $routes->group('', ['filter' => 'feature:roles'], static function (RouteCollection $routes) {
        $routes->get('roles', 'ClientController::roles');
        $routes->post('roles', 'ClientController::createRole');
        $routes->post('roles/(:num)', 'ClientController::updateRole/$1');
        $routes->post('roles/(:num)/delete', 'ClientController::deleteRole/$1');
    });

    // Staff / team
    $routes->get('staff', 'ClientController::staff');
    $routes->get('staff/(:num)/leads', 'ClientController::staffLeads/$1');
    $routes->post('staff', 'ClientController::createStaff');
    $routes->post('staff/(:num)', 'ClientController::updateStaff/$1');
    $routes->post('staff/(:num)/delete', 'ClientController::deleteStaff/$1');

    // Lead setup (statuses, marketing types, sources, lead/conversion types).
    // Not a separate feature — it comes with the 'leads' feature.
    $routes->group('', ['filter' => 'feature:leads'], static function (RouteCollection $routes) {
        // Leads (the records themselves)
        $routes->get('leads', 'ClientController::leads');
        $routes->get('lead-analytics', 'ClientController::leadAnalytics');
        $routes->post('leads', 'ClientController::createLead');
        $routes->post('leads/import', 'ClientController::importLeads');
        $routes->get('leads/(:num)/detail', 'ClientController::leadDetail/$1');
        $routes->post('leads/(:num)/reminders', 'ClientController::createReminder/$1');
        $routes->post('leads/(:num)/notes', 'ClientController::createNote/$1');
        $routes->post('lead-reminders/(:num)/delete', 'ClientController::deleteReminder/$1');
        $routes->post('lead-notes/(:num)/delete', 'ClientController::deleteNote/$1');
        $routes->post('leads/(:num)', 'ClientController::updateLead/$1');
        $routes->post('leads/(:num)/delete', 'ClientController::deleteLead/$1');

        // Call tracking — ingest (from the external call app) + activity list.
        $routes->post('call-logs', 'ClientController::createCallLogs');
        $routes->get('calls', 'ClientController::calls');
        $routes->get('call-dashboard', 'ClientController::callDashboard');
        $routes->get('followup-dashboard', 'ClientController::followupDashboard');

        $routes->get('lead-statuses', 'ClientController::leadStatuses');
        $routes->post('lead-statuses', 'ClientController::createLeadStatus');
        $routes->post('lead-statuses/reorder', 'ClientController::reorderLeadStatuses');
        $routes->post('lead-statuses/(:num)', 'ClientController::updateLeadStatus/$1');
        $routes->post('lead-statuses/(:num)/delete', 'ClientController::deleteLeadStatus/$1');

        $routes->get('leads-setup', 'ClientController::leadsSetup');
        $routes->get('marketing-types', 'ClientController::marketingTypes');
        $routes->post('marketing-types', 'ClientController::createMarketingType');
        $routes->post('marketing-types/reorder', 'ClientController::reorderMarketingTypes');
        $routes->post('marketing-types/(:num)', 'ClientController::updateMarketingType/$1');
        $routes->post('marketing-types/(:num)/delete', 'ClientController::deleteMarketingType/$1');
        $routes->get('lead-sources', 'ClientController::leadSources');
        $routes->post('lead-sources', 'ClientController::createLeadSource');
        $routes->post('lead-sources/reorder', 'ClientController::reorderLeadSources');
        $routes->post('lead-sources/(:num)', 'ClientController::updateLeadSource/$1');
        $routes->post('lead-sources/(:num)/delete', 'ClientController::deleteLeadSource/$1');
        $routes->get('lead-types', 'ClientController::leadTypes');
        $routes->post('lead-types', 'ClientController::createLeadType');
        $routes->post('lead-types/reorder', 'ClientController::reorderLeadTypes');
        $routes->post('lead-types/(:num)', 'ClientController::updateLeadType/$1');
        $routes->post('lead-types/(:num)/delete', 'ClientController::deleteLeadType/$1');
        $routes->get('conversion-types', 'ClientController::conversionTypes');
        $routes->post('conversion-types', 'ClientController::createConversionType');
        $routes->post('conversion-types/reorder', 'ClientController::reorderConversionTypes');
        $routes->post('conversion-types/(:num)', 'ClientController::updateConversionType/$1');
        $routes->post('conversion-types/(:num)/delete', 'ClientController::deleteConversionType/$1');

        $routes->get('followup-groups', 'ClientController::followupGroups');
        $routes->post('followup-groups', 'ClientController::createFollowupGroup');
        $routes->post('followup-groups/reorder', 'ClientController::reorderFollowupGroups');
        $routes->post('followup-groups/(:num)', 'ClientController::updateFollowupGroup/$1');
        $routes->post('followup-groups/(:num)/delete', 'ClientController::deleteFollowupGroup/$1');
    });

    // Announcements
    $routes->get('announcements', 'ClientController::announcements');
    $routes->post('announcements', 'ClientController::createAnnouncement');
    $routes->get('announcements/(:num)/readers', 'ClientController::announcementReaders/$1');
    $routes->post('announcements/(:num)/delete', 'ClientController::deleteAnnouncement/$1');

    // Tasks (gated by the 'tasks' plan feature)
    $routes->get('tasks', 'ClientController::tasks', ['filter' => 'feature:tasks']);
    $routes->post('tasks', 'ClientController::createTask', ['filter' => 'feature:tasks']);
    $routes->get('tasks/(:num)', 'ClientController::task/$1', ['filter' => 'feature:tasks']);
    $routes->post('tasks/(:num)', 'ClientController::updateTask/$1', ['filter' => 'feature:tasks']);
    $routes->post('tasks/(:num)/delete', 'ClientController::deleteTask/$1', ['filter' => 'feature:tasks']);
    $routes->get('tasks/(:num)/comments', 'ClientController::taskComments/$1', ['filter' => 'feature:tasks']);
    $routes->post('tasks/(:num)/comments', 'ClientController::addTaskComment/$1', ['filter' => 'feature:tasks']);
    $routes->post('tasks/(:num)/comments/(:num)/delete', 'ClientController::deleteTaskComment/$1/$2', ['filter' => 'feature:tasks']);
    $routes->get('tasks/(:num)/activity', 'ClientController::taskActivity/$1', ['filter' => 'feature:tasks']);

    // File/image upload (staff photo, asset attachment)
    $routes->post('upload', 'ClientController::upload');

    // Option lists for the staff form (lead type / office location / department)
    $routes->get('lookups', 'ClientController::lookups');

    // Departments — managed from their own section, gated by the Team module.
    // Deletes are soft (archive) and reversible via restore.
    $routes->get('departments', 'ClientController::departmentsList', ['filter' => 'feature:team']);
    $routes->post('departments', 'ClientController::createDepartment', ['filter' => 'feature:team']);
    $routes->post('departments/(:num)', 'ClientController::updateDepartment/$1', ['filter' => 'feature:team']);
    $routes->post('departments/(:num)/delete', 'ClientController::deleteDepartment/$1', ['filter' => 'feature:team']);
    $routes->post('departments/(:num)/restore', 'ClientController::restoreDepartment/$1', ['filter' => 'feature:team']);

    // Office locations — own section, gated by Team module. Soft delete + restore.
    $routes->get('office-locations', 'ClientController::officeLocationsList', ['filter' => 'feature:team']);
    $routes->post('office-locations', 'ClientController::createOfficeLocation', ['filter' => 'feature:team']);
    $routes->post('office-locations/(:num)', 'ClientController::updateOfficeLocation/$1', ['filter' => 'feature:team']);
    $routes->post('office-locations/(:num)/delete', 'ClientController::deleteOfficeLocation/$1', ['filter' => 'feature:team']);
    $routes->post('office-locations/(:num)/restore', 'ClientController::restoreOfficeLocation/$1', ['filter' => 'feature:team']);

    // Asset management (gated by the 'assets' plan feature)
    $routes->group('', ['filter' => 'feature:assets'], static function (RouteCollection $routes) {
        $routes->get('assets', 'ClientController::assets');
        $routes->post('assets', 'ClientController::createAsset');
        $routes->get('assets/(:num)/history', 'ClientController::assetHistory/$1');
        $routes->post('assets/(:num)/allocate', 'ClientController::allocateAsset/$1');
        $routes->post('assets/(:num)/transfer', 'ClientController::transferAsset/$1');
        $routes->post('assets/(:num)/revoke', 'ClientController::revokeAsset/$1');
        $routes->post('assets/(:num)/note', 'ClientController::addAssetNote/$1');
        $routes->post('assets/(:num)', 'ClientController::updateAsset/$1');
        $routes->post('assets/(:num)/delete', 'ClientController::deleteAsset/$1');
    });

    // Chat (client ↔ support, plus team room + 1:1 DMs with staff) + notifications
    $routes->get('chat/conversations', 'ChatController::conversations');
    $routes->post('chat/conversations/start', 'ChatController::startConversation');
    $routes->get('chat/directory', 'ChatController::directory');
    $routes->post('chat/dm/start', 'ChatController::startDm');
    $routes->get('chat/conversations/(:num)/messages', 'ChatController::messages/$1');
    $routes->post('chat/conversations/(:num)/messages', 'ChatController::sendMessage/$1');
    $routes->get('chat/poll', 'ChatController::poll');
    $routes->get('notifications', 'ChatController::notifications');
    $routes->post('notifications/read-all', 'ChatController::readAllNotifications');
    $routes->post('notifications/(:num)/read', 'ChatController::readNotification/$1');

    // Materialise due lead reminders into notifications (polled by the client app).
    $routes->get('reminders/poll', 'ClientController::remindersPoll');
});
