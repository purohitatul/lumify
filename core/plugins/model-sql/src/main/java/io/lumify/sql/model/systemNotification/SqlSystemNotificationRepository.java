package io.lumify.sql.model.systemNotification;

import com.google.inject.Inject;
import com.google.inject.Singleton;
import io.lumify.core.model.systemNotification.SystemNotification;
import io.lumify.core.model.systemNotification.SystemNotificationRepository;
import io.lumify.core.model.systemNotification.SystemNotificationSeverity;
import io.lumify.core.user.User;
import io.lumify.core.util.LumifyLogger;
import io.lumify.core.util.LumifyLoggerFactory;
import io.lumify.sql.model.HibernateSessionManager;
import org.hibernate.Session;

import java.util.Date;
import java.util.List;
import java.util.UUID;

@Singleton
public class SqlSystemNotificationRepository extends SystemNotificationRepository {
    private static final LumifyLogger LOGGER = LumifyLoggerFactory.getLogger(SqlSystemNotificationRepository.class);
    private final HibernateSessionManager sessionManager;

    @Inject
    public SqlSystemNotificationRepository(HibernateSessionManager sessionManager) {
        this.sessionManager = sessionManager;
    }

    @Override
    public List<SystemNotification> getActiveNotifications(User user) {
        Session session = sessionManager.getSession();
        List<SystemNotification> activeNotifications = session.createQuery(
                "select sn from " + SqlSystemNotification.class.getSimpleName() + " as sn where sn.startDate <= :now and (sn.endDate is null or sn.endDate > :now)")
                .setParameter("now", new Date())
                .list();
        LOGGER.debug("returning %d active system notifications", activeNotifications.size());
        return activeNotifications;
    }

    @Override
    public List<SystemNotification> getFutureNotifications(Date maxDate, User user) {
       Session session = sessionManager.getSession();
        List<SystemNotification> futureNotifications = session.createQuery(
                "select sn from " + SqlSystemNotification.class.getSimpleName() + " as sn where sn.startDate > :now and sn.startDate < :maxDate")
                .setParameter("now", new Date())
                .setParameter("maxDate", maxDate)
                .list();
        LOGGER.debug("returning %d future system notifications", futureNotifications.size());
        return futureNotifications;
    }

    @Override
    public SystemNotification createNotification(SystemNotificationSeverity severity, String title, String message, Date startDate, Date endDate) {
        if (startDate == null) {
            startDate = new Date();
        }
        String id = Long.toString(startDate.getTime()) + ":" + UUID.randomUUID().toString();
        Session session = sessionManager.getSession();
        SqlSystemNotification notification = new SqlSystemNotification();
        notification.setId(id);
        notification.setSeverity(severity);
        notification.setTitle(title);
        notification.setMessage(message);
        notification.setStartDate(startDate);
        notification.setEndDate(endDate);
        session.save(notification);
        return notification;
    }

    @Override
    public SystemNotification updateNotification(SystemNotification notification) {
        Session session = sessionManager.getSession();
        session.update(notification);
        return notification;
    }

    @Override
    public void endNotification(SystemNotification notification) {
        Session session = sessionManager.getSession();
        notification.setEndDate(new Date());
        session.update(notification);
    }
}
