package io.lumify.web;

import com.google.inject.Inject;
import io.lumify.core.model.user.UserRepository;
import io.lumify.core.util.LumifyLogger;
import io.lumify.core.util.LumifyLoggerFactory;
import org.atmosphere.cpr.AtmosphereResource;
import org.atmosphere.cpr.PerRequestBroadcastFilter;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class MessagingFilter implements PerRequestBroadcastFilter {
    private static final LumifyLogger LOGGER = LumifyLoggerFactory.getLogger(MessagingFilter.class);
    private UserRepository userRepository;

    @Override
    public BroadcastAction filter(AtmosphereResource r, Object originalMessage, Object message) {
        try {
            JSONObject json = new JSONObject("" + originalMessage);
            JSONObject permissionsJson = json.optJSONObject("permissions");
            if (permissionsJson == null) {
                return new BroadcastAction(message);
            }

            JSONArray users = permissionsJson.optJSONArray("users");
            if (users != null) {
                String currentUserId = CurrentUser.get(r.getRequest().getSession());
                if (!isUserInList(users, currentUserId)) {
                    return new BroadcastAction(BroadcastAction.ACTION.ABORT, message);
                }
            }

            JSONArray workspaces = permissionsJson.optJSONArray("workspaces");
            if (workspaces != null) {
                String currentUserId = CurrentUser.get(r.getRequest().getSession());
                if (!isWorkspaceInList(workspaces, userRepository.getCurrentWorkspaceId(currentUserId))) {
                    return new BroadcastAction(BroadcastAction.ACTION.ABORT, message);
                }
            }

            return new BroadcastAction(message);
        } catch (JSONException e) {
            LOGGER.error("Failed to filter message:\n" + originalMessage, e);
            return new BroadcastAction(BroadcastAction.ACTION.ABORT, message);
        }
    }

    private boolean isWorkspaceInList(JSONArray workspaces, String currentWorkspace) throws JSONException {
        for (int i = 0; i < workspaces.length(); i++) {
            String workspaceItemRowKey = workspaces.getString(i);
            if (workspaceItemRowKey.equals(currentWorkspace)) {
                return true;
            }
        }
        return false;
    }

    private boolean isUserInList(JSONArray users, String userId) throws JSONException {
        for (int i = 0; i < users.length(); i++) {
            String userItemId = users.getString(i);
            if (userItemId.equals(userId)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public BroadcastAction filter(Object originalMessage, Object message) {
        return new BroadcastAction(message);
    }

    @Inject
    public void setUserRepository(UserRepository userRepository) {
        this.userRepository = userRepository;
    }
}
